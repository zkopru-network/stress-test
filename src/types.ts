import Web3 from 'web3'
import { OrganizerQueueConfig } from './organizer-queue'

// Generator types

// Organizer API types
interface GasData {
  from: string
  inputSize: number
  gasUsed?: number
}

export interface WalletData {
  id?: number
  from: string
  weiPerByte: number
}

export interface CoordinatorData {
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
  coordinators: CoordinatorData[]
}

export type RegisterData = 
| { role : 'wallet', params: WalletData }
| { role : 'coordinator', params: CoordinatorData } 

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
  from?: string
  layer1TxHash?: string
  layer1BlockNumber?: number
  finalized?: boolean // TODO: add feature to update from finzlizer
}

export interface OrganizerData {
  layer1: {
    txData: TxData[]
    auctionData: AuctionData
    proposeData: ProposeData[]
    gasTable: { [sig: string]: GasData[] }
  }
  coordinatorData: CoordinatorData[]
  walletData: WalletData[]
}
