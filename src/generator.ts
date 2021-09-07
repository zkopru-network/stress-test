// import fs from 'fs'
import BN from 'bn.js'
import fetch from 'node-fetch'
import { toWei } from 'web3-utils'
import { Queue, Worker, ConnectionOptions, QueueScheduler } from 'bullmq'

import { Fp } from '@zkopru/babyjubjub'
import { UtxoStatus, Utxo } from '@zkopru/transaction'
import { HDWallet } from '@zkopru/account'
import { logger, sleep } from '@zkopru/utils'
import { ZkWalletAccount, ZkWalletAccountConfig } from '@zkopru/zk-wizard'
import { ZkTxData, ZkTxJob } from './organizer-queue'
import { TestTxBuilder } from './testbuilder'
import { logAll, getZkTx } from './generator-utils'
import { config } from './config'

export interface GeneratorConfig {
  hdWallet: HDWallet
  weiPrice?: string
  ID?: number
  redis?: { host: string; port: number }
  preZkTxPath?: string
}

interface Queues {
  mainQueue: Queue<ZkTxData, any, string>
  walletQueue: Queue<ZkTxData, any, string>
}

const organizerUrl = process.env.ORGANIZER_URL ?? 'http://organizer:8080'

//* * Only ETH transafer zkTx generator as 1 inflow 2 outflows */
export class TransferGenerator extends ZkWalletAccount {
  ID: number

  isActive: boolean

  lastSalt: number

  usedUtxoSalt: Set<number>

  weiPrice: string

  preZkTxPath: string

  queues: Queues

  queueConnection: ConnectionOptions

  constructor(config: ZkWalletAccountConfig & GeneratorConfig) {
    super(config)
    this.ID = config.ID ?? Math.floor(Math.random() * 10000) // TODO : It seems only need in docker environment
    this.isActive = false
    this.preZkTxPath =
      config.preZkTxPath ?? `/proj/packages/generator/zktx/${this.ID}`
    this.lastSalt = 0
    this.usedUtxoSalt = new Set([])
    this.weiPrice = config.weiPrice ?? toWei('2000', 'gwei')

    /**  
     * Starting with Ether Note generated by deposit tx, It has 1 as salt
    
    the salt will be using a sequence for mass transaction in layer 2 for testing
     
         2 - 4 ...
       /   \  
     1       5 ...
       \     
         3 - 6 ...
           \
             7 ...
    */
    this.queueConnection = {
      host: config.redis?.host ?? 'localhost',
      port: config.redis?.port ?? 6379,
    }

    this.queues = {
      mainQueue: new Queue('mainQueue', { connection: this.queueConnection }),
      walletQueue: new Queue(`wallet${this.ID}`, {
        connection: this.queueConnection,
      }),
    }
  }

  async startWorker() {
    logger.info(`Worker started`)
    const worker = new Worker(
      `wallet${this.ID}`,
      async (job: ZkTxJob) => {
        try {
          const { tx, zkTx } = job.data
          const txSalt = tx.inflow[0].salt // TODO : use this for following the sequence as the salt
          const response = await this.sendLayer2Tx(getZkTx(zkTx))
          if (response.status !== 200) {
            this.lastSalt = txSalt.toNumber()
            await this.unlockUtxos(tx.inflow)
            throw Error(await response.text())
          }
        } catch (error) {
          logger.error(`Error on worker process : ${error}`)
        }
      },
      { connection: this.queueConnection },
    )

    worker.on('completed', (job: ZkTxJob) => {
      logger.info(
        `Worker job salt ${logAll(job.data.tx.inflow[0].salt)} completed`,
      )
    })

    const walletScheduler = new QueueScheduler(`wallet${this.ID}`, {
      connection: this.queueConnection,
    })
    logger.info(`${walletScheduler.name} scheduler on`)
  }

  async startGenerator() {
    if (!this.node.isRunning()) {
      this.node.start()
    }

    // TODO: check first deposit Note hash
    try {
      const result = await this.depositEther(
        toWei('50'),
        toWei('0.01'),
        this.account?.zkAddress,
        Fp.from(1),
      )
      if (!result) {
        throw new Error(' Deposit Transaction Failed!')
      } else {
        logger.info(`Deposit Tx sent`)
      }
    } catch (err) {
      logger.error(err)
    }

    while (!this.isActive) {
      await sleep(5000)
      const stagedDeposit = await this.node.layer1.upstream.methods
        .stagedDeposits()
        .call()

      if (+stagedDeposit.merged === 0) {
        this.isActive = true
        // TODO: replace organizer url from system environment
        const id = await fetch(`${organizerUrl}/register`, {
          method: 'post',
          body: JSON.stringify({
            ID: this.ID,
            from: this.account?.ethAddress,
          }),
        })
        logger.info(
          `Deposit Tx is processed, then registered as ${id} this wallet to Organizer`,
        )
      }
    }

    this.startWorker()

    while (this.isActive) {
      // TODO: how to recognize target queue is changed?
      // get TPS from organizer... or get sum of all tx in wait active delayes...
      const response = await fetch(`${organizerUrl}/txsInQueues`, {
        method: 'get',
      })
      const { currentTxs } = await response.json()

      /* eslint-disable no-continue */
      if (currentTxs >= config.mainQueueLimit) {
        await sleep(1000)
        continue
      } else {
        logger.debug(`current job count ${currentTxs}`)
      }

      const unspentUTXO = await this.getUtxos(this.account, UtxoStatus.UNSPENT)

      if (unspentUTXO.length === 0) {
        logger.info('No Spendable Utxo, wait until available')
        await sleep(5000)
        continue
      }

      // All transaction are self transaction with same amount, only unique things is salt.
      let sendableUtxo: Utxo | undefined

      for (const utxo of unspentUTXO) {
        let isUsedUtxo = false
        if (this.usedUtxoSalt.has(utxo.salt.toNumber())) {
          isUsedUtxo = true
        }

        if (!isUsedUtxo) {
          sendableUtxo = utxo
          break
        }
      }

      if (sendableUtxo) {
        const testTxBuilder = new TestTxBuilder(this.account?.zkAddress!)
        const tx = testTxBuilder
          .provide(sendableUtxo)
          .weiPerByte(this.weiPrice)
          .sendEther({
            eth: sendableUtxo.asset.eth.div(new BN(2)), // TODO: eth amount include a half of fee
            salt: sendableUtxo.salt.muln(2),
            to: this.account?.zkAddress!,
          })
          .build()

        const parsedZkTx = {
          inflow: tx.inflow.map(flow => {
            return {
              hash: flow.hash().toString(),
              salt: flow.salt.toString(10),
              eth: flow.eth().toString(10),
            }
          }),
          outflow: tx.outflow.map(flow => {
            return {
              hash: flow.hash().toString(),
              salt: flow.salt.toString(10),
              eth: flow.eth().toString(10),
            }
          }),
        }
        logger.trace(`Created ZkTx : ${logAll(parsedZkTx)}`)
        try {
          const zkTx = await this.shieldTx({ tx })
          this.usedUtxoSalt.add(sendableUtxo.salt.toNumber())
          this.queues.mainQueue.add(`wallet${this.ID}`, { tx, zkTx })
        } catch (err) {
          logger.error(err)
        }
      } else {
        logger.debug(`No available utxo for now wait 5 sec`)
        await sleep(5000)
      }
    }
  }

  stopGenerator() {
    this.isActive = false
  }
}
