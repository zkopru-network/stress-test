import Web3 from 'web3'
import AsyncLock from 'async-lock'
import { Fp } from '@zkopru/babyjubjub'
import { logger, sleep } from '@zkopru/utils'
import { Layer1, IBurnAuction } from '@zkopru/contracts'
import { OrganizerConfig } from './context'

import {
  BidData,
  AuctionData,
  TxData,
  OperationInfo,
  WalletInfo,
  CoordinatorInfo,
  ProposeData,
} from './types'
import { config } from '../config'

type blockStat = {
  blockNumber: number,
  gasLimit: number,
  gasUsed: number
}

interface GasData {
  from: string
  inputSize: number
  gasUsed?: number
}

interface zkopruConfig {
  maxBlockSize?: number
  maxValidationGas?: number
  challengePeriod?: number
  minimumStake?: number
  maxUtxoDepth?: number
}

interface BlockData {
  blockNumber: number
  blockHash: string
  gasLimit: number
  gasUsed: number
  transactions: string[]
}

export interface OnChainData {
  txData: TxData[]
  blockData: BlockData[]
  auctionData: AuctionData
  zkopruConfig: zkopruConfig
  proposeData: ProposeData[]
  gasTable: { [sig: string]: GasData[] }
}

// To avoid syncronization with coordinator node, only use web3 for listening events.
export class OrganizerData {
  operationInfo?: OperationInfo

  registerLock: AsyncLock

  lastDepositerID: number = 0

  coordinatorInfo: CoordinatorInfo[] = []

  walletInfo: WalletInfo[] = []

  blockData: any // TODO: set types 

  onChainData: OnChainData

  web3: Web3

  auction: IBurnAuction

  zkopru: any // TODO: export 'Zkopru' interface in zkopru repo

  constructor(organizerConfig: OrganizerConfig) {
    this.registerLock = new AsyncLock()

    this.onChainData = {
      txData: [],
      blockData: [],
      auctionData: {},
      zkopruConfig: {},
      gasTable: {},
      proposeData: []
    } // Initialize

    this.web3 = new Web3(organizerConfig.node.web3Provider)
    this.auction = Layer1.getIBurnAuction(this.web3 as any, config.auctionContract)
    this.zkopru = Layer1.getZkopru(this.web3 as any, config.zkopruContract)

    this.updateAuctionData()
  }


  registerCoordinator = (updatedData: CoordinatorInfo) => {
    this.registerLock.acquire(
      'coordinator', () => {
        try {
          let coordinatorId: number

          if (updatedData.id) {
            coordinatorId = updatedData.id
            logger.info(`stress-test/organizer/data.ts - update coordinator-${coordinatorId} data`)
            this.coordinatorInfo.find((data, index) => {
              if (data.id == coordinatorId) {
                this.coordinatorInfo[index] = { ...updatedData }
              }
            })
          } else {
            logger.info(`stress-test/organizer/data.ts - register new coordinator`)
            coordinatorId = this.coordinatorInfo.length + 1
            this.coordinatorInfo.push({ id: coordinatorId, ...updatedData })
          }
          return coordinatorId
        } catch (error) {
          logger.warn(`stress-test/organizer/data.ts - error on registering coordinator: ${error}`)
          return 0
        }
      })
  }

  registerWallet = async (updatedData: WalletInfo) => {
    return await this.registerLock.acquire('wallet', () => {
      try {
        let walletId: number
        const walletData = this.walletInfo
        if (updatedData.id) {
          walletId = updatedData.id
          logger.info(`stress-test/organizer/data.ts - registered wallet_${walletId} updated`)
          walletData.find((data, index) => {
            if (data.id == updatedData.id) {
              walletData[index] = { ...updatedData }
              this.lastDepositerID = walletId
            }
          })
        } else {
          walletId = walletData.length + 1
          this.walletInfo.push({ id: walletId, ...updatedData })
          logger.info(`stress-test/organizer/data.ts - not found walletId, updated ${walletId} for registering wallet`)
        }
        return walletId
      } catch (error) {
        logger.error(`stress-test/organizer/data.ts - error on registering wallet: ${error}`)
        return 0
      }
    })
  }

  // onChainData process helper functions
  updateAuctionData = () => {
    this.auction.events.NewHighBid().on(`data`, async (data) => {
      const { calcRoundStart } = this.auction.methods
      const { roundIndex, bidder, amount } = data.returnValues
      const { auctionData } = this.onChainData
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

  getContractInfo = async () => {
    this.onChainData.zkopruConfig = {
      maxBlockSize: await this.zkopru.methods.MAX_BLOCK_SIZE().call(),
      maxValidationGas: await this.zkopru.methods.MAX_VALIDATION_GAS().call(),
      challengePeriod: await this.zkopru.methods.CHALLENGE_PERIOD().call(),
      minimumStake: await this.zkopru.methods.MINIMUM_STAKE().call(),
      maxUtxoDepth: await this.zkopru.methods.UTXO_TREE_DEPTH().call(),
    }
  }

  setOperationInfo = async (gitData: any, hostInfo: any, targetTPS: number) => {
    this.operationInfo = {
      testnetInfo: {
        nodeInfo: await this.web3.eth.getNodeInfo(),
        chainId: await this.web3.eth.getChainId()
      },
      operation: {
        startTime: Date.now(),
        endTime: 0, // Use this for checking status of result from CI side.
        targetTPS,
      },
      systemInformation: {
        cpu: hostInfo.cpuInfo,
        memory: hostInfo.memInfo
      },
      git: gitData
    }
  }

  // calc TPS data
  calcTPSdata() {
    const { proposeData } = this.onChainData
    
    let result
    let previousProposeTime: number

    if (proposeData !== []) {
      result = proposeData
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
        .sort((a, b) => a.proposedTime - b.proposedTime)
    } else {
      result = []
    }
    return result
  }

  /** 
   * Methods for generating a data of testing result
  */

  // Configuration
  static calcAvgBlockGasLimit(blockData: BlockData[]) {
    const sumGasLimit = blockData.reduce((sum: Fp, data: blockStat) => sum.add(Fp.from(data.gasLimit)), Fp.from(0))

    return sumGasLimit.div(Fp.from(blockData.length)).toNumber()
  }

  // calculating TPS on layer2 blocks, proposals.
  static processProposeData(data: OnChainData, limit?: number) {
    const { proposeData } = data
    let firstProposeTime = 0

    const txCount = {
      total: 0,
      last24h: 0,
      last01h: 0
    }

    let lastProposeBlocks: any[] = []

    const lastProposeTime = proposeData.reduce((acc, propose) => {
      return Math.max(acc, propose.timestamp)
    }, 0)

    for (const propose of proposeData) {
      if (propose.proposeNum == 0) { firstProposeTime = propose.timestamp }

      const diffTime = lastProposeTime - propose.timestamp

      txCount.total += propose.txcount

      if (diffTime <= (24 * 3600 * 1000)) {
        txCount.last24h += propose.txcount
      }
      if (diffTime <= (3600 * 1000)) {
        txCount.last01h += propose.txcount
      }

      // Keep last proposed block data limited in 10
      lastProposeBlocks.unshift(propose)
      lastProposeBlocks.length = Math.min(lastProposeBlocks.length, limit ?? 1000)
    }

    return {
      performance: {
        firstProposeTime,
        lastProposeTime,
        txCount
      },
      recentProposedBlocks: [...lastProposeBlocks]
    }
  }

  // Coordinator
  static processCoordinatorData(coordinatorData, data: OnChainData) {
    // const { coordinatorInfo: coordinatorData } = data
    const { proposeData, auctionData } = data

    let lastProposedNum = 0
    const coordinatorInfo = {}

    coordinatorData.map((coordinator) => {
      coordinatorInfo[coordinator.from.toLowerCase()] = {
        name: `coordinator_${coordinator.id}`,
        proposedCount: 0,
        totalTxCount: 0,
        totalPaidFee: Fp.from(0),
        totalSpentForBid: Fp.from(0)
      }
    })

    // accumulated from propose data
    proposeData.forEach(propose => {
      const proposer = propose.from!
      const { totalPaidFee } = coordinatorInfo[proposer]
      try {
        coordinatorInfo[proposer].proposedCount += 1
        coordinatorInfo[proposer].totalTxCount += propose.txcount
        coordinatorInfo[proposer].totalPaidFee = totalPaidFee.add(Fp.from(propose.paidFee))
        lastProposedNum = Math.max(lastProposedNum, propose.layer1BlockNumber!)
      } catch (error) {
        throw Error(`processing Error - ${error}, propose.paidFee ${propose.paidFee}`)
      }
    })

    // caculating totalSpentForBid, Only accumulated bidding fee which has layer1 inlude
    const openRounds = Object.keys(auctionData)
    const recentAuctionData: any[] = []

    openRounds.forEach(roundNum => {
      const { highestBid, bidHistory } = auctionData[roundNum]

      if (highestBid.startBlock <= lastProposedNum) {
        const from = highestBid.bidder.toLowerCase()
        const { totalSpentForBid } = coordinatorInfo[from]
        coordinatorInfo[from].totalSpentForBid = totalSpentForBid.add(Fp.from(highestBid.bidAmount))
      }

      recentAuctionData.unshift({ highestBid, roundNum, totalBidCount: bidHistory.length })
      recentAuctionData.length = Math.min(openRounds.length, 1000)
    })

    return { recentAuctionData, coordinatorInfo }
  }

  // Extract tx data which related zkopru testing account from layer 1 Block data
  static processTxData(data: OnChainData) {
    const { txData, blockData } = data
    // 
    const txHashes = txData.map(data => { return Object.keys(data)[0] })

    const lastZkopruTxIncluded: any[] = []

    let pointer = blockData.length - 1
    while (lastZkopruTxIncluded.length < 1000) {
      if (pointer == 0) break // No more found
      const block = blockData[pointer]
      let zkopruTxCount = 0

      for (const tx of block.transactions) {
        if (txHashes.includes(tx)) {
          zkopruTxCount += 1
        }
      }
      if (zkopruTxCount != 0) lastZkopruTxIncluded.push({ ...block, zkopruTxCount })
      pointer -= 1
    }

    return lastZkopruTxIncluded
  }

  updatedResult = () => {
    try {
      const { performance, recentProposedBlocks } = OrganizerData.processProposeData(this.onChainData)
      const { recentAuctionData, coordinatorInfo } = OrganizerData.processCoordinatorData(this.coordinatorInfo, this.onChainData)
      return {
        info: this.operationInfo,
        configuration: {
          layer1: {
            chainId: this.operationInfo?.testnetInfo!.chainId,
            nodeInfo: this.operationInfo?.testnetInfo!.nodeInfo,
            avgBlockGasLimit: OrganizerData.calcAvgBlockGasLimit(this.onChainData.blockData)
          },
          zkopruConfig: this.onChainData.zkopruConfig,
          coordinatorConfig: this.coordinatorInfo

        },
        testResult: {
          tpsData: this.calcTPSdata(),
          performance,
          recentProposedBlocks,
          recentAuctionData,
          coordinatorInfo,
          walletInfo: this.walletInfo,
          recentTxData: OrganizerData.processTxData(this.onChainData)
        }
      }
    } catch (error) {
      logger.error(`stress-test/organizer/data.ts - createReulst error : ${error}`)
      return {}
    }
  }

  /**
   * End of section of the methods, generating the data of testing result.
   */

  checkReady = async (): Promise<any> => {
    // Wait for deploy contract
    while (true) {
      const contractCode = await this.web3.eth.getCode(config.auctionContract)
      if (contractCode.length > 10000) {
        break
      } else {
        await sleep(1000)
      }
    }

    return this.web3.eth.subscribe('newBlockHeaders')
  }

  watchLayer1 = async () => {
    const { blockData: blockStats, txData, gasTable } = this.onChainData // Initialized by constructor

    const watchTargetContracts = [config.zkopruContract, config.auctionContract]

    const updateData = async (data: any, web3: Web3) => {
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
    }

    // TODO : consider reorg for data store, It might need extra fields
    this.web3.eth.subscribe('newBlockHeaders').on('data', (data) => updateData(data, this.web3))
  }
}
