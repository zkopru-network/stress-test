import Web3 from 'web3'
import { Fp } from '@zkopru/babyjubjub'
import  si from 'systeminformation'
import { OrganizerQueueConfig } from './organizer-queue'

// Generator types

// Organizer API types
interface GasData {
  from: string
  inputSize: number
  gasUsed?: number
}

export interface OperationInfo {
  testnetInfo?: {
    nodeInfo: string
    chainId: number
  }
  operation?: {
    startTime: number
    endTime: number
    checkTime?: number
  }
  systemInformation?: {
    cpu: si.Systeminformation.CpuData,
    memory: si.Systeminformation.MemData,
  }
  git?: {
    [repoName: string]: {
      branch: string
      commit: string
    }
  }
}

export interface WalletInfo {
  id?: number
  name?: string
  from: string
  weiPerByte: number
  generatedTx?: number
  totalSpentFee?: string
}

export interface CoordinatorInfo {
  id?: number
  url: string
  from: string
  maxBytes: number
  priceMultiplier: number
  maxBid: number
}

export interface OrganizerConfig extends OrganizerQueueConfig {
  dev?: boolean
  organizerPort?: number
}

export interface OrganizerContext {
  web3: Web3
  coordinators: CoordinatorInfo[]
}

export type RegisterData = 
| { role : 'wallet', params: WalletInfo }
| { role : 'coordinator', params: CoordinatorInfo } 

export interface TxData {
  [txHash: string]: {
    from: string
    gas: number
    gasUsed?: number
    success?: boolean
  }
}

export interface BidData {
  bidder: string
  bidAmount: number
  startBlock: number
  txHash: string
  blockNumber: number
}

export interface AuctionData {
  [roundIndex: number]: {
    highestBid: BidData
    bidHistory: BidData[]
  }
}

export interface ProposeData {
  timestamp: number
  proposeNum: number
  parentsBlockHash: string
  blockHash: string
  txcount: number
  paidFee: Fp
  from?: string
  layer1TxHash?: string
  layer1BlockNumber?: number
  finalized?: boolean // TODO: add feature to update from finzlizer
}

type zkopruConfig = {
    maxBlockSize?: number,
    maxValidationGas?: number,
    challengePeriod?: number,
    minimumStake?: number,
    maxUtxoDepth?: number,
}

export interface OrganizerData {
  operationInfo: OperationInfo
  coordinatorInfo: CoordinatorInfo[]
  walletInfo: WalletInfo[]
  layer1: {
    blockData: any
    txData: TxData[]
    auctionData: AuctionData
    zkopruConfig: zkopruConfig
    proposeData: ProposeData[]
    gasTable: { [sig: string]: GasData[] }
  }
}
