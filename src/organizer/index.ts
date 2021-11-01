import Web3 from 'web3'
import { logger } from '@zkopru/utils'
import { startLogger } from '../generator-utils'
import { config } from '../config'
import { OrganizerConfig } from './context'
import { Organizer } from './organizer'

startLogger('ORGANIZER_LOG')

logger.info('stress-test/organizer/index.ts - organizer initializing')

const isDevelopment = process.env.DEVELOPMENT ?? false

const webSocketProvider = new Web3.providers.WebsocketProvider(
  isDevelopment ? 'localhost:8545' : config.testnetUrl,
  {
    reconnect: { auto: true },
    timeout: 600,
  },
)

const organizerConfig: OrganizerConfig = {
  dev: !!isDevelopment,
  node: {
    redis: { host: isDevelopment ? 'localhost' : 'redis', port: 6379 },
    web3Provider: webSocketProvider
  },
  rates: [
    { name: '0.1', max: 1, duration: 10000 },
    { name: '1', max: 1, duration: 1000 },
    { name: '10', max: 10, duration: 1000 },
    { name: '20', max: 20, duration: 1000 },
    { name: '50', max: 50, duration: 1000 },
    { name: '100', max: 100, duration: 1000 },
  ],
  organizerPort: 8080,
}

const organizer = new Organizer(organizerConfig)
organizer.start()
logger.info('stress-test/organizer/indext.ts - organizer started')
