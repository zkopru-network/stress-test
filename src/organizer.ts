import Web3 from 'web3'
import { logger } from '~utils'
import { startLogger } from './generator-utils'
import { config } from './config'
import { OrganizerConfig } from './types'
import { OrganizerApi } from './organizer-api'

startLogger('ORGANIZER_LOG')

logger.info('Organizer Initializing')

const coordinatorUrl = process.env.COORDINATOR_URL ?? `http://coordinator:8888`
const isDevelopment = process.env.DEVELOPMENT

const webSocketProvider = new Web3.providers.WebsocketProvider(
  isDevelopment ? 'localhost:8545' : config.testnetUrl,
  {
    reconnect: { auto: true },
    timeout: 600,
  },
)
const web3 = new Web3(webSocketProvider)

const organierContext = {
  web3,
  dev: isDevelopment,
  coordinators: {
    [config.zkopruContract]: coordinatorUrl,
  },
} // Test Coordinator

const organizerConfig: OrganizerConfig = {
  connection: { host: isDevelopment ? 'localhost' : 'redis', port: 6379 },
  dev: !!isDevelopment,
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

const organizer = new OrganizerApi(organierContext, organizerConfig)
organizer.start()
