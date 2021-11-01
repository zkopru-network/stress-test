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

  contractsReady: boolean

  context: OrganizerContext

  organizerApi: OrganizerApi

  constructor(organizerConfig: OrganizerConfig) {
    this.config = organizerConfig
    this.contractsReady = false

    this.context = {
      contractsReady: this.contractsReady,
      organizerData: new OrganizerData(organizerConfig),
      organizerQueue: new OrganizerQueue(organizerConfig)
    }

    this.organizerApi = new OrganizerApi(this.context, organizerConfig)
  }

  // get data from `organizerQueue` than update `organizerData` when start function initiate
  async updateOperationInfo() {
    // host systeminformation
    const cpuInfo = await si.cpu()
    const memInfo = await si.mem()

    // git branch and commit heash
    const targetMeta = ['stress-test', 'zkopru']
    let gitData = {}

    // TODO: set header file path 
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

    const { targetTPS } = this.context.organizerQueue.currentRate()

    const { setOperationInfo } = this.context.organizerData
    setOperationInfo(gitData, { cpuInfo, memInfo }, targetTPS)
  }


  private async checkReady() {
    // waiting at least one coordinator activate
    const result = await this.context.organizerData.checkReady()
    this.contractsReady = true;
    return result
  }

  async start() {
    this.updateOperationInfo()
    this.organizerApi.start()

    // for development
    if (this.config.dev) {
      this.contractsReady = true
      logger.info(`stress-test/organizer.ts - zkopru contract are ready`)
    } else {
      const readySubscribtion = await this.checkReady()

      logger.info(`stress-test/organizer.ts - Waiting zkopru contracts are ready`)
      while (this.contractsReady === false) {
        await sleep(5000)
      }

      await readySubscribtion.unsubscribe((error, success) => {
        if (success) {
          logger.info('stress-test/organizer.ts - successfully unsubscribe "ready", run block watcher')
        }
        if (error) {
          logger.error(`stress-test/organizer.ts - failed to unsubscribe "ready": ${error} `)
        }
      })

      // Start Layer1 block watcher
      await this.context.organizerData.watchLayer1()
    }
  }

  async stop() {
    this.organizerApi.stop()

  }
}
