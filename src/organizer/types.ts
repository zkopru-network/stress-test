import { Fp } from '@zkopru/babyjubjub'
import  si from 'systeminformation'

export interface OperationInfo {
  testnetInfo?: {
    nodeInfo: string
    chainId: number
  }
  operation?: {
    startTime: number
    endTime: number
    checkTime?: number
    targetTPS?: number
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
  finalized?: boolean // TODO: add a feature to update this 
}
