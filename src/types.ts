import Web3 from 'web3'
import { OrganizerQueueConfig } from './organizer-queue'

// Generator types

// Organizer API types
interface GasData {
  from: string
  inputSize: number
  gasUsed?: number
}

export interface WalletParams {
  id?: number
  weiPerByte: number
}

export interface WalletData  {
  [account: string]: WalletParams
}

export interface CoordinatorParams {
  id?: number
  url: string
  maxBytes: number
  priceMultiplier: number
  maxBid: number
}

export interface CoordinatorData {
  [account: string]: CoordinatorParams
}

export interface OrganizerConfig extends OrganizerQueueConfig {
  dev?: boolean
  organizerPort?: number
}

export interface OrganizerContext {
  web3: Web3
  coordinators: CoordinatorData
}

export interface RegisterData {
  role: 'wallet' | 'coordinator'
  id?: number
  from: string
  url: string
  params?: WalletParams | CoordinatorParams
}

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
  coordinatorData: CoordinatorData
  walletData: WalletData
}
