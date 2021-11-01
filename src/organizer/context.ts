import { HttpProvider, WebsocketProvider } from 'web3-core'
import { OrganizerQueue } from "./queue"
import { OrganizerData } from './data'

interface QueueRate {
  max: number
  name?: string
  duration?: number
}

export interface OrganizerConfig  {
  dev: boolean
  node: {
    redis: { host: string; port: number }
    web3Provider: HttpProvider | WebsocketProvider
  }
  rates: QueueRate[]
  organizerPort?: number
}

export interface OrganizerContext {
  contractsReady: boolean
  
  organizerData: OrganizerData
  
  organizerQueue: OrganizerQueue
}

