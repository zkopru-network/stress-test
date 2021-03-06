/* eslint-disable import/no-extraneous-dependencies */
import fs from 'fs'
import express from 'express'
import { Server } from 'http'
import { logger } from '@zkopru/utils'
import { logAll } from '../generator-utils'
import { RegisterData, ProposeData } from './types'
import { OrganizerContext, OrganizerConfig } from './context'

// To avoid syncronization with coordinator node, only use web3 for listening events.
class OrganizerApi {
  config: OrganizerConfig

  context: OrganizerContext

  server?: Server

  constructor(context: OrganizerContext, organizerConfig: OrganizerConfig) {
    this.context = context
    this.config = organizerConfig
  }

  createResultData = (): any => {
    // get current `tx` and `fee` data from subQueue of wallets
    const { queueData } = this.context.organizerQueue
    const walletKeys = Object.keys(queueData)

    const result = this.context.organizerData.updatedResult()

    // update data to walletinfo on `organizerData`
    try {
      walletKeys.forEach(wallet => {
        const walletId = parseInt(wallet.split("_")[1])

        result.testResult!.walletInfo
          .filter(data => data.id == walletId)
          .map(data => {
            data.generatedTx = queueData[wallet].txCount
            data.totalSpentFee = queueData[wallet].spentFee.toString()
          })
      })
    } catch (error) {
      logger.warn(`stress-test/organizer/api.ts - wallet info may not updated yet, try later: ${error}`)
    }

    // generate report data for testing result
    return result
  }

  start = () => {
    const app = express()
    const { organizerData, organizerQueue } = this.context
    app.use(express.text())

    app.get(`/ready`, async (_, res) => {
      res.send(this.context.contractsReady)
    })

    app.get(`/info`, async (_, res) => {
      res.send(organizerData.operationInfo)
    })

    app.get(`/zkopru-info`, async (_, res) => {
      res.send(organizerData.onChainData.zkopruConfig)
    })

    app.get(`/block-data`, async (req, res) => {
      let limit = 100

      if (req.query.limit) {
        limit = parseInt(req.query.limit as string, 10)
      }

      res.send(organizerData.onChainData.blockData.slice(-1 * limit))
    })

    app.get(`/tx-data`, async (_, res) => {
      res.send(organizerData.onChainData.txData)
    })

    app.get('/registered-node-info', async (_, res) => {
      res.send({ coordinators: organizerData.coordinatorInfo, wallets: organizerData.walletInfo })
    })

    app.get(`/auction-data`, async (_, res) => {
      res.send(organizerData.onChainData.auctionData)
    })

    app.get(`/proposed-data`, async (req, res) => {
      let limit = 100 // about 44kb
      if (req.query.limit) {
        limit = parseInt(req.query.limit as string, 10)
      }
      res.send(organizerData.onChainData.proposeData.slice(-1 * limit))
    })

    app.get(`/result`, async (_, res) => {
      res.send(this.createResultData())
    })

    app.get(`/download-result`, async (_, res) => {
      const result = this.createResultData()
      // TODO: use uuid create result filename 
      fs.writeFileSync('resultData.json', JSON.stringify(result), 'utf8')
      res.download('resultData.json')
    })

    app.post('/register', async (req, res) => {
      let data: RegisterData

      try {
        data = JSON.parse(req.body) as RegisterData
        logger.trace(`stress-test/organizer/api.ts - register received data ${logAll(data)}`)
      } catch (err) {
        logger.error(`stress-test/organizer/api.ts - register error ${err}`)
        res.status(500).send(`register error - debug organizer/api log`)
        return
      }

      if (data.role === 'wallet') {
        const registeredId = await this.context.organizerData.registerWallet(data.params)
        this.context.organizerQueue.addWalletQueue(`wallet_${registeredId}`)

        if (data.params?.id == registeredId) {
          res.send({ id: registeredId, message: "wallet registered" })
        } else {
          res.send({ id: registeredId, message: "waiting deposit for registeration" })
        }
      } else if (data.role === 'coordinator') {
        const registeredId = await this.context.organizerData.registerCoordinator(data.params)
        res.send({ id: registeredId, message: "coordinator registered" })
      } else {
        res.status(400).send(`Only 'wallet' or 'coordinator' allows for role`)
      }
    })

    app.post('/can-deposit', async (req, res) => {
      const data = JSON.parse(req.body)
      const { lastDepositerID } = this.context.organizerData
      const isRequesterTurn = lastDepositerID + 1 === +data.id
      if (this.context.contractsReady && isRequesterTurn) {
        res.send(true)
      } else {
        res.send(false)
      }
    })

    app.post('/propose-blocks', async (req, res) => {
      try {
        const data = JSON.parse(req.body) as ProposeData
        const { finalized, ...proposeData } = data
        organizerData.onChainData.proposeData.push(proposeData)
        res.sendStatus(200)
      } catch (error) {
        res.status(500).send(`Organizer server error: ${error}`)
      }
    })

    app.get('/gastable-data', (_, res) => {
      res.send(organizerData.onChainData.gasTable)
    })

    app.get('/tps-data', (req, res) => {
      // TODO : consider might happen uncle block for calculation of tps
      const limit = req.params.limit ?? 100
      
      if (organizerData.onChainData.proposeData !== []) {
        const tpsData = this.context.organizerData.calcTPSdata()
        res.send(tpsData.slice(-1 * limit))
      } else {
        res.send(`Not yet proposed on Layer2`)
      }
    })

    app.get('/current-rate', async (_, res) => {
      res.send(this.context.organizerQueue.currentRate())
    })

    app.get('/txs-in-queues', async (_, res) => {
      const remainJobs = await this.context.organizerQueue.allRemainingJobs()
      res.status(200).send({ currentTxs: remainJobs })
    })

    app.post('/select-rate', async (req, res) => {
      try {
        const data = JSON.parse(req.body)
        const { selectRate } = data

        const rateNames = this.context.organizerQueue.config.rates.map(rate => {
          return rate.name
        })
        logger.info(`stress-test/organizer/api.ts - selectable rates: ${logAll(rateNames)}`)

        if (!rateNames.includes(selectRate)) {
          res.status(406).send(`only selectable rates are ${logAll(rateNames)}`)
          return
        }

        const result = organizerQueue.selectRate(selectRate)
        res.send(result)
      } catch (error) {
        res.status(400).send(`${error}`)
      }
    })

    // TODO : create metric endpoint
    app.get(`/metric`, async (_, res) => {
      return res.sendStatus(200)
    })

    this.server = app.listen(this.config.organizerPort, () => {
      logger.info(`stress-test/organizer/api.ts - server is running`)
    })
  }

  stop = (): Promise<void> => {
    return new Promise(res => {
      if (this.server) {
        this.server.close(() => res())
      } else {
        res()
      }
    })
  }
}

export default OrganizerApi
