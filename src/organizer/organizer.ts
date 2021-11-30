/* eslint-disable import/no-extraneous-dependencies */
import fs from 'fs'
import si from 'systeminformation'
import { logger, sleep } from '@zkopru/utils'
import { OrganizerConfig, OrganizerContext } from './context'
import { OrganizerQueue } from './queue'
import { OrganizerData } from './data'
import OrganizerApi from './api'

export class Organizer {
  config: OrganizerConfig

  context: OrganizerContext

  organizerApi: OrganizerApi

  constructor(organizerConfig: OrganizerConfig) {
    this.config = organizerConfig

    this.context = {
      contractsReady: false,
      organizerQueue: new OrganizerQueue(organizerConfig),
      organizerData: new OrganizerData(organizerConfig),
    }

    this.organizerApi = new OrganizerApi(this.context, organizerConfig)
  }

  // get data from `organizerQueue` than update `organizerData` when start function initiate
  updateOperationInfo = async () => {
    // host systeminformation
    const cpuInfo = await si.cpu()
    const memInfo = await si.mem()

    // git branch and commit heash
    const gitData = {
      "stress-test": {
        branch: process.env.TEST_BRANCH ?? "Not found",
        commit: process.env.TEST_COMMIT_HASH ?? "0000000000000000000000000000000000000000"
      },
      zkopru: {
        branch: process.env.ZKOPRU_BRANCH ?? "Not found",
        commit: process.env.ZKOPRU_COMMIT_HASH ?? "0000000000000000000000000000000000000000"
      }
    }

    const { targetTPS } = this.context.organizerQueue.currentRate()

    const { setOperationInfo } = this.context.organizerData
    setOperationInfo(gitData, { cpuInfo, memInfo }, targetTPS)
  }

  start = async () => {
    this.updateOperationInfo()
    this.organizerApi.start()

    // for development
    if (this.config.dev) {
      this.context.contractsReady = true
      logger.info(`stress-test/organizer.ts - zkoprucontract are ready as dev mode`)
    } else {
      const readySubscribtion = await this.context.organizerData.checkReady()
      logger.info(`stress-test/organizer.ts - got checkReady from context`)
      readySubscribtion.on('data', async () => {
        const activeCoordinator = await this.context.organizerData.auction.methods
          .activeCoordinator()
          .call()
        if (+activeCoordinator) {
          logger.info(`activeCoordinator is ${activeCoordinator}`)
          this.context.contractsReady = true
          this.context.organizerData.getContractInfo()
        }
      })

      logger.info(`stress-test/organizer.ts - Waiting zkopru contracts are ready`)
      while (this.context.contractsReady !== true) {
        await sleep(5000)
      }
      this.context.contractsReady = true

      await readySubscribtion.unsubscribe((error, success) => {
        if (success) {
          logger.info('stress-test/organizer.ts - successfully unsubscribe for  "ready", run block watcher')
        }
        if (error) {
          logger.error(`stress-test/organizer.ts - failed to unsubscribe "ready": ${error} `)
        }
      })

      // Start Layer1 block watcher
      await this.context.organizerData.watchLayer1()
    }
  }

  stop = async () => {
    await this.organizerApi.stop()
  }
}
