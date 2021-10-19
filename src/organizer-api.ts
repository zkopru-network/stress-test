/* eslint-disable import/no-extraneous-dependencies */
import fs from 'fs'
import AsyncLock from 'async-lock'
import express from 'express'
import si from 'systeminformation'
import { logger, sleep } from '@zkopru/utils'
import { Layer1, IBurnAuction } from '@zkopru/contracts'
import { OrganizerQueue } from './organizer-queue'
import { logAll } from './generator-utils'
import {
  processConfigurationData,
  processCoordinatorData,
  processProposeData,
  processTxData,
} from './dataToJson'
import {
  OrganizerConfig,
  OrganizerContext,
  BidData,
  RegisterData,
  OrganizerData,
  ProposeData,
  OperationInfo,
  WalletInfo,
  CoordinatorInfo
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

  zkopru: any // TODO: export 'Zkopru' interface in zkopru repo 

  constructor(context: OrganizerContext, organizerConfig: OrganizerConfig) {
    this.context = context
    this.organizerData = {
      operationInfo: {},
      coordinatorInfo: [],
      walletInfo: [],
      layer1: {
        blockData: [],
        txData: [],
        auctionData: {},
        zkopruConfig: {},
        gasTable: {},
        proposeData: []
      }
    } // Initialize

    this.organizerQueue = new OrganizerQueue(organizerConfig)
    this.registerLock = new AsyncLock()
    this.lastDepositerID = 0
    this.contractsReady = false

    this.config = organizerConfig
    this.auction = Layer1.getIBurnAuction(context.web3 as any, config.auctionContract)
    this.zkopru = Layer1.getZkopru(context.web3 as any, config.zkopruContract)

    this.updateAuctionData()
  }

  registerCoordinator(updatedData: CoordinatorInfo) {
    try {
      let coordinatorId: number
      const coordinatorData = this.organizerData.coordinatorInfo
      if (updatedData.id) {
        coordinatorId = updatedData.id
        logger.info(`stress-test/organizer-api.ts - update coordinator-${coordinatorId} data`)
        coordinatorData.find((data, index) => {
          if (data.id == coordinatorId) {
            coordinatorData[index] = { ...updatedData }
          }
        })
      } else {
        logger.info(`stress-test/organizer-api.ts - register new coordinator`)
        coordinatorId = coordinatorData.length + 1
        coordinatorData.push({ id: coordinatorId, ...updatedData })
      }
      return coordinatorId
    } catch (error) {
      logger.warn(`stress-test/organizer-api.ts - error on registering coordinator: ${error}`)
      return 0
    }
  }

  registerWallet(updatedData: WalletInfo) {
    try {
      let walletId: number
      const walletData = this.organizerData.walletInfo
      if (updatedData.id) {
        walletId = updatedData.id
        logger.info(`stress-test/organizer-api.ts - registered wallet_${walletId} updated`)
        walletData.find((data, index) => {
          if (data.id == updatedData.id) {
            walletData[index] = { ...updatedData }
            this.lastDepositerID = walletId
          }
        })
      } else {
        logger.info(`stress-test/organizer-api.ts - not found walletId, count registered wallets then use it id and update`)
        walletId = walletData.length + 1
        this.organizerData.walletInfo.push({ id: walletId, ...updatedData })
        const allWalletQueues = this.organizerQueue.addWalletQueue(
          `wallet_${walletId}`,
        )
        logger.info(`stress-test/organizer-api.ts - queues for wallets: ${allWalletQueues}`)
      }
      return walletId
    } catch (error) {
      logger.error(`stress-test/organizer-api.ts - error on registering wallet: ${error}`)
      return 0
    }
  }

  updateAuctionData() {
    this.auction.events.NewHighBid().on(`data`, async (data) => {
      const { calcRoundStart } = this.auction.methods
      const { roundIndex, bidder, amount } = data.returnValues
      const { auctionData } = this.organizerData.layer1
      const indexedRound = Object.keys(auctionData)

      const bidAmount = parseInt(amount, 10)
      const startBlock = parseInt(await calcRoundStart(roundIndex).call(), 10)

      const bidData: BidData = {
        bidder,
        bidAmount,
        startBlock,
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

  async getContractInfo() {
    this.organizerData.layer1.zkopruConfig = {
      maxBlockSize: await this.zkopru.methods.MAX_BLOCK_SIZE().call(),
      maxValidationGas: await this.zkopru.methods.MAX_VALIDATION_GAS().call(),
      challengePeriod: await this.zkopru.methods.CHALLENGE_PERIOD().call(),
      minimumStake: await this.zkopru.methods.MINIMUM_STAKE().call(),
      maxUtxoDepth: await this.zkopru.methods.UTXO_TREE_DEPTH().call(),
    }
  }

  async getOperationInfo() {
    // Testnet Info
    const { web3 } = this.context

    // host systeminformation
    const cpuInfo = await si.cpu()
    const memInfo = await si.mem()

    // git branch and commit heash
    const targetMeta = ['stress-test', 'zkopru']
    let gitData = {}
    
    targetMeta.forEach(repo => {
      let branch: string
      let commit: string
      const headFile = (`metadata/${repo}/HEAD`)

      if (fs.existsSync(headFile)) {
        const head = fs.readFileSync(`metadata/${repo}/HEAD`)
        const headPath = head.toString().split(" ")[1].trim()
        const headHash = fs.readFileSync(`metadata/${repo}/${headPath}`)

        branch = headPath.split("/").slice(2,).join("/"),
          commit = headHash.toString().trim()
      } else {
        branch = "Not Found",
          commit = "0000000000000000000000000000000000000000"
      }
      gitData[repo] = { branch, commit }
    })

    const info: OperationInfo = {
      testnetInfo: {
        nodeInfo: await web3.eth.getNodeInfo(),
        chainId: await web3.eth.getChainId(),
      },
      operation: {
        startTime: Date.now(),
        endTime: 0,
      },
      systemInformation: {
        cpu: cpuInfo,
        memory: memInfo
      },
      git: gitData
    }
    return info
  }

  updateWalletData() {
    const queueData = this.organizerQueue.queueData
    const walletKeys = Object.keys(queueData)
    logger.info(`walletKeys : ${walletKeys}`)

    walletKeys.forEach(wallet => {
      const walletId = parseInt(wallet.split("_")[1])

      this.organizerData.walletInfo
        .filter(data => data.id == walletId)
        .map(data => {
          data.generatedTx = queueData[wallet].txCount
          data.totalSpentFee = queueData[wallet].spentFee.toString()
        })
    })
  }

  createResult() {
    const { Performance, recentProposedBlocks } = processProposeData(this.organizerData)
    const { recentAuctionData, coordinatorInfo } = processCoordinatorData(this.organizerData)
    return {
      info: this.organizerData.operationInfo,
      configuration: processConfigurationData(this.organizerData),
      testResult: {
        Performance,
        recentProposedBlocks,
        recentAuctionData,
        coordinatorInfo,
        walletInfo: this.organizerData.walletInfo,
        recentTxData: processTxData(this.organizerData)
      }
    }
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
        this.contractsReady = true;
        await this.getContractInfo()
      }
    })
  }

  private async watchLayer1() {
    const { web3 } = this.context
    const { blockData: blockStats, txData, gasTable } = this.organizerData.layer1 // Initialized by constructor

    const watchTargetContracts = [config.zkopruContract, config.auctionContract]

    // TODO : consider reorg for data store, It might need extra fields
    web3.eth.subscribe('newBlockHeaders').on('data', async function (data) {
      const blockData = await web3.eth.getBlock(data.hash)
      const { number, hash, gasLimit, gasUsed, transactions } = blockData
      blockStats.push({ blockNumber: number, blockHash: hash, gasLimit, gasUsed, transactions })

      if (transactions) {
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
    this.organizerData.operationInfo = await this.getOperationInfo()

    const app = express()
    app.use(express.text())

    app.get(`/ready`, async (_, res) => {
      res.send(this.contractsReady)
    })

    app.get(`/info`, async (_, res) => {
      res.send(this.organizerData.operationInfo)
    })

    app.get(`/zkopru-info`, async (_, res) => {
      res.send(this.organizerData.layer1.zkopruConfig)
    })

    app.get(`/block-data`, async (req, res) => {
      let limit = 100

      if (req.query.limit) {
        limit = parseInt(req.query.limit as string, 10)
      }

      res.send(this.organizerData.layer1.blockData.slice(-1 * limit))
    })

    app.get(`/tx-data`, async (_, res) => {
      res.send(this.organizerData.layer1.txData)
    })

    app.get('/registered-node-info', async (_, res) => {
      res.send({ coordinators: this.organizerData.coordinatorInfo, wallets: this.organizerData.walletInfo })
    })

    app.get(`/auction-data`, async (_, res) => {
      res.send(this.organizerData.layer1.auctionData)
    })

    app.get(`/proposed-data`, async (req, res) => {
      let limit = 100 // about 44kb
      if (req.query.limit) {
        limit = parseInt(req.query.limit as string, 10)
      }
      res.send(this.organizerData.layer1.proposeData.slice(-1 * limit))
    })

    app.get(`/result`, async (_, res) => {
      const result = this.createResult()
      res.send(result)
    })

    app.get(`/download-result`, async (_, res) => {
      this.updateWalletData()
      const allData = this.createResult()
      fs.writeFileSync('resultData.json', JSON.stringify(allData), 'utf8') // TODO: using uuid for fileame
      res.download('resultData.json')
    })

    app.post('/register', async (req, res) => {
      let data: RegisterData
      try {
        data = JSON.parse(req.body) as RegisterData
        logger.trace(`stress-test/organizer-api.ts - register received data ${logAll(data)}`)
      } catch (err) {
        logger.error(`stress-test/organizer-api.ts - register error ${err}`)
        return
      }

      // The test wallet's address will be updated after first deposit
      if (data.role === 'wallet') {
        const registeredId = await this.registerLock.acquire('wallet', () => {
          return this.registerWallet(data.params as WalletInfo) // only get id number before deposit to registration
        })
        if (data.params?.id == registeredId) {
          res.send({ id: registeredId, message: "registered" })
        } else {
          res.send({ id: registeredId, message: "waiting deposit for registeration" })
        }
      } else if (data.role === 'coordinator') {
        const registeredId = await this.registerLock.acquire(
          'coordinator',
          () => {
            return this.registerCoordinator(data.params as CoordinatorInfo) // only get id number before deposit to
          })
        res.send({ id: registeredId, message: "registered" })
      } else {
        res.status(400).send(`Only 'wallet' or 'coordinator' allows for role`)
      }
    })

    app.post('/can-deposit', async (req, res) => {
      if (!this.contractsReady) {
        res.send(false)
        return
      }

      const data = JSON.parse(req.body)
      if (this.lastDepositerID + 1 === +data.id) {
        res.send(true)
      } else {
        res.send(false)
      }
    })

    app.post('/propose-blocks', async (req, res) => {
      try {
        const data = JSON.parse(req.body) as ProposeData
        const {
          from,
          timestamp,
          blockHash,
          parentsBlockHash,
          proposeNum,
          txcount,
          paidFee,
          layer1TxHash,
          layer1BlockNumber,
        } = data
        this.organizerData.layer1.proposeData.push({
          timestamp,
          proposeNum,
          blockHash,
          parentsBlockHash,
          txcount,
          paidFee,
          from,
          layer1TxHash,
          layer1BlockNumber,
        })
        res.sendStatus(200)
      } catch (err) {
        res.status(500).send(`Organizer server error: ${err.toString()}`)
      }
    })

    app.get('/gastable-data', (_, res) => {
      res.send(this.organizerData.layer1.gasTable)
    })

    app.get('/tps-data', (req, res) => {
      // TODO : consider might happen uncle block for calculation of tps
      let previousProposeTime: number
      let limit = 100
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
              proposedTime: data.timestamp,
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

    app.get('/current-rate', async (_, res) => {
      res.send(this.organizerQueue.currentRate())
    })

    app.get('/txs-in-queues', async (_, res) => {
      const remainJobs = await this.organizerQueue.allRemainingJobs()
      res.status(200).send({ currentTxs: remainJobs })
    })

    app.post('/select-rate', async (req, res) => {
      try {
        const data = JSON.parse(req.body)
        const { selectRate } = data

        const rateNames = this.organizerQueue.config.rates.map(rate => {
          return rate.name
        })
        logger.info(`stress-test/organizer-api.ts - selectable rates ${logAll(rateNames)}`)

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
      logger.info(`stress-test/organizer-api.ts - server is running`)
    })

    // for development
    if (this.config.dev) {
      this.contractsReady = true
      logger.info(`stress-test/organizer-api.ts - zkopru contract are ready`)
    } else {
      const readySubscribtion = await this.checkReady()

      logger.info(`stress-test/organizer-api.ts - Waiting zkopru contracts are ready`)
      while (this.contractsReady === false) {
        await sleep(5000)
      }

      await readySubscribtion.unsubscribe((error, success) => {
        if (success) {
          logger.info('stress-test/organizer-api.ts - successfully unsubscribe "ready", run block watcher')
        }
        if (error) {
          logger.error(`stress-test/organizer-api.ts - failed to unsubscribe "ready": ${error} `)
        }
      })

      // Start Layer1 block watcher
      this.watchLayer1()
    }
  }
}
