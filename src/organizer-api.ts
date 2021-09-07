/* eslint-disable import/no-extraneous-dependencies */
import AsyncLock from 'async-lock'
import express from 'express'
import { logger, sleep } from '@zkopru/utils'
import { Layer1, IBurnAuction } from '@zkopru/contracts'
import { OrganizerQueue } from './organizer-queue'
import { logAll } from './generator-utils'
import {
  OrganizerConfig,
  OrganizerContext,
  BidData,
  RegisterData,
  OrganizerData,
  ProposeData,
  WalletParams,
  CoordinatorParams
} from './types'
import { config } from './config'

// To avoid syncronization with coordinator node, only use web3 for listening events.
export class OrganizerApi {
  config: OrganizerConfig

  context: OrganizerContext

  contractsReady: boolean

  organizerData: OrganizerData

  organizerQueue: OrganizerQueue

  registerLock: AsyncLock

  lastDepositerID: number

  auction: IBurnAuction

  constructor(context: OrganizerContext, organizerConfig: OrganizerConfig) {
    this.context = context
    this.organizerData = {
      layer1: {
        txData: [],
        auctionData: {},
        gasTable: {},
        proposeData: []
      },
      coordinatorData: {},
      walletData: {},
    } // Initialize

    this.organizerQueue = new OrganizerQueue(organizerConfig)
    this.registerLock = new AsyncLock()
    this.lastDepositerID = 0
    this.contractsReady = false

    this.config = organizerConfig
    this.auction = Layer1.getIBurnAuction(context.web3 as any, config.auctionContract)

    this.updateAuctionData()
  }

  // TODO: check this method purpose
  registerCoordinator(account: string, updateData: CoordinatorParams) {
    try {
      let coordinatorId: number
      if (account in this.organizerData.coordinatorData) {
        const coordinatorCount = Object.keys(this.organizerData.coordinatorData).length
        coordinatorId = (coordinatorCount ?? 0) + 1     
      } else {
        coordinatorId = this.organizerData.coordinatorData[account].id!
      }
      const { url, maxBytes, priceMultiplier, maxBid } = updateData
      this.organizerData.coordinatorData[account]  = {
        id: coordinatorId,
        url, 
        maxBytes, 
        priceMultiplier, 
        maxBid 
      }
      return coordinatorId
    } catch (error) {
      logger.warn(`Error on registering coordinator - ${error}`)
      return
    }
  }

  registerWallet(account: string, weiPerByte: number) {
    try {
      let walletId: number
      if (account in this.organizerData.coordinatorData) {
        const walletCount = Object.keys(this.organizerData.coordinatorData).length
        walletId = (walletCount ?? 0) + 1     
      } else {
        walletId = this.organizerData.coordinatorData[account].id!
      }

      logger.debug(
        `Current length ${walletId}, ${logAll(
          this.organizerData.walletData,
        )}`,
      )
  
      this.organizerData.walletData[account] = {
        id: walletId,
        weiPerByte
      }
  
      // Queue for contol tx flow rate
      const allWalletQueues = this.organizerQueue.addWalletQueue(
        `wallet${walletId}`,
      )
      logger.trace(`registered wallet queues are ${logAll(allWalletQueues)}`)
      return walletId
    } catch (error) {
      logger.error(`Error on registering wallet - ${error}`)
      return
    }
  }

  updateAuctionData() {
    this.auction.events.NewHighBid().on(`data`, data => {
      const { roundIndex, bidder, amount } = data.returnValues
      const { auctionData } = this.organizerData.layer1
      const indexedRound = Object.keys(auctionData)

      const bidAmount = parseInt(amount, 10)
      const bidData: BidData = {
        bidder,
        bidAmount,
        txHash: data.transactionHash as string,
        blockNumber: data.blockNumber as number,
      }
      if (!indexedRound.includes(roundIndex)) {
        auctionData[roundIndex] = {
          highestBid: bidData,
          bidHistory: [],
        }
      } else if (
        auctionData[roundIndex].highestBid.bidAmount < bidData.bidAmount
      ) {
        auctionData[roundIndex].highestBid = bidData
      }
      // store bidData to history
      auctionData[roundIndex].bidHistory.push(bidData)
    })
  }

  private async checkReady() {
    const { web3 } = this.context

    // Wait for deploy contract
    while (true) {
      const contractCode = await web3.eth.getCode(config.auctionContract)
      if (contractCode.length > 10000) {
        break
      } else {
        await sleep(1000)
      }
    }

    return web3.eth.subscribe('newBlockHeaders').on('data', async () => {
      const activeCoordinator = await this.auction.methods
        .activeCoordinator()
        .call()
      if (+activeCoordinator) {
        this.contractsReady = true
      }
    })
  }

  private async watchLayer1() {
    const { web3 } = this.context
    const { txData, gasTable } = this.organizerData.layer1 // Initialized by constructor

    const watchTargetContracts = [config.zkopruContract, config.auctionContract]

    // TODO : consider reorg for data store, It might need extra fields
    web3.eth.subscribe('newBlockHeaders').on('data', async function(data) {
      const blockData = await web3.eth.getBlock(data.hash)
      if (blockData.transactions) {
        blockData.transactions.forEach(async txHash => {
          const tx = await web3.eth.getTransaction(txHash)

          if (tx.to && watchTargetContracts.includes(tx.to)) {
            const funcSig = tx.input.slice(0, 10)
            const inputSize = tx.input.length
            const receipt = await web3.eth.getTransactionReceipt(txHash)

            // Update gasTable
            if (gasTable[funcSig] === undefined) {
              gasTable[funcSig] = [
                {
                  from: tx.from,
                  inputSize,
                  gasUsed: receipt.gasUsed ?? 0,
                },
              ]
            } else {
              gasTable[funcSig].push({
                from: tx.from,
                inputSize,
                gasUsed: receipt.gasUsed ?? 0,
              })
            }
            txData.push({ [txHash]: { ...tx, ...receipt } })
          }
        })
      }
    })
  }

  async start() {
    const app = express()
    app.use(express.text())

    app.get(`/ready`, async (_, res) => {
      res.send(this.contractsReady)
    })

    app.get(`/txData`, async (_, res) => {
      res.send(this.organizerData.layer1.txData)
    })

    app.get('/registered', async (_, res) => {
      res.send({coordinators: this.organizerData.coordinatorData, wallets: this.organizerData.walletData})
    })

    app.get(`/auctionStatus`, async (_, res) => {
      res.send(this.organizerData.layer1.auctionData)
    })

    app.get(`/proposedBlocks`, async (req, res) => {
      let limit = 100 // about 44kb
      if (req.query.limit) {
        limit = parseInt(req.query.limit as string, 10)
      }
      res.send(this.organizerData.layer1.proposeData.slice(-1 * limit))
    })

    app.post('/register', async (req, res) => {
      let data: RegisterData
      try {
        data = JSON.parse(req.body) as RegisterData
        logger.info(`register received data ${logAll(data)}`)
      } catch (err) {
        logger.error(`registration error ${err}`)
        return
      }

      // The test wallet's address will be updated after first deposit
      if (data.role === 'wallet') {
        if (data.params?.id) {
          const configData = data.params as WalletParams
          logger.info(`updating address ${data.id} as ${configData.weiPerByte}`)

          this.organizerData.walletData[data.from] = {
            id: configData.id,
            weiPerByte: configData.weiPerByte
          }
          // Does not worry about racing condition
          // wallet watching blocks then follow the sequence
          this.lastDepositerID = configData.id!
          res.send({ id: data.params.id, message: "registered"})
          return
        }
        const registeredId = await this.registerLock.acquire('wallet', () => {
          return this.registerWallet(data.from, 0) // only get id number before deposit to registration
        })
        res.send({ id: registeredId, message: "pending" })
      } else if (data.role === 'coordinator') {
        const coordinatorParams = data.params as CoordinatorParams
        const registeredId = await this.registerLock.acquire(
          'coordinator',
          () => {
            return this.registerCoordinator(data.from, coordinatorParams)
          })
        res.send({ id: registeredId, message: "registered" })
      } else {
        res.status(400).send(`Only 'wallet' or 'coordinator' allows for role`)
      }
    })

    app.post('/canDeposit', async (req, res) => {
      if (!this.contractsReady) {
        res.send(false)
        return
      }

      const data = JSON.parse(req.body)
      if (+data.ID === this.lastDepositerID + 1) {
        res.send(true)
      } else {
        res.send(false)
      }
    })

    app.post('/propose', async (req, res) => {
      try {
        const data = JSON.parse(req.body) as ProposeData
        const {
          from,
          timestamp,
          blockHash,
          parentsBlockHash,
          proposeNum,
          txcount,
          layer1TxHash,
          layer1BlockNumber,
        } = data
        this.organizerData.layer1.proposeData.push({
          timestamp,
          proposeNum,
          blockHash,
          parentsBlockHash,
          txcount,
          from,
          layer1TxHash,
          layer1BlockNumber,
        })
        res.sendStatus(200)
      } catch (err) {
        res.status(500).send(`Organizer server error: ${err.toString()}`)
      }
    })

    app.get('/gastable', (_, res) => {
      res.send(this.organizerData.layer1.gasTable)
    })

    app.get('/tps', (req, res) => {
      // TODO : consider might happen uncle block for calculation of tps
      let previousProposeTime: number
      let limit = 1000
      if (req.query.limit) {
        limit = parseInt(req.query.limit as string, 10)
      }
      if (this.organizerData.layer1.proposeData !== []) {
        const response = this.organizerData.layer1.proposeData
          .slice(-1 * (limit + 1))
          .map(data => {
            if (data.proposeNum === 0) {
              previousProposeTime = data.timestamp
            }
            const duration = Math.floor(
              (data.timestamp - previousProposeTime) / 1000,
            )
            previousProposeTime = data.timestamp
            return {
              proposalNum: data.proposeNum,
              duration,
              txcount: data.txcount,
              tps: data.txcount / duration,
            }
          })
        res.send(response.slice(-1 * limit))
      } else {
        res.send(`Not yet proposed on Layer2`)
      }
    })

    app.get('/currentRate', async (_, res) => {
      res.send(this.organizerQueue.currentRate())
    })

    app.get('/txsInQueues', async (_, res) => {
      const remainJobs = await this.organizerQueue.allRemainingJobs()
      res.status(200).send({ currentTxs: remainJobs })
    })

    // TODO : create metric with prom-client
    app.post('/selectRate', async (req, res) => {
      try {
        const data = JSON.parse(req.body)
        const { selectRate } = data

        const rateNames = this.organizerQueue.config.rates.map(rate => {
          return rate.name
        })
        logger.info(`selectable rates ${logAll(rateNames)}`)

        if (!rateNames.includes(selectRate)) {
          res.status(406).send(`only selectable rates are ${logAll(rateNames)}`)
          return
        }

        const result = this.organizerQueue.selectRate(selectRate)
        res.send(result)
      } catch (error) {
        res.status(400).send(`${error}`)
      }
    })

    // TODO : create metric endpoint
    app.get(`/metric`, async (_, res) => {
      return res.sendStatus(200)
    })

    app.listen(this.config.organizerPort, () => {
      logger.info(`Server is running`)
    })

    // for development
    if (this.config.dev) {
      this.contractsReady = true
      logger.info(`Development : zkopru contract are ready`)
    } else {
      const readySubscribtion = await this.checkReady()

      logger.info(`Waiting zkopru contracts are ready`)
      while (this.contractsReady === false) {
        await sleep(5000)
      }

      await readySubscribtion.unsubscribe((error, success) => {
        if (success) {
          logger.info('successfully unsubscribe "ready", run block watcher')
        }
        if (error) {
          logger.error(`failed to unsubscribe "ready" `)
        }
      })

      // Start Layer1 block watcher
      this.watchLayer1()
    }
  }
}
