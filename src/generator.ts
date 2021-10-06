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
  id?: number
  redis?: { host: string; port: number }
}

interface Queues {
  mainQueue: Queue<ZkTxData, any, string>
  walletQueue: Queue<ZkTxData, any, string>
}

const organizerUrl = process.env.ORGANIZER_URL ?? 'http://organizer:8080'

//* * Only ETH transafer zkTx generator as 1 inflow 2 outflows */
export class TransferGenerator extends ZkWalletAccount {
  id: number | undefined

  isActive: boolean


  usedUtxoSalt: Set<number>

  weiPerBytes: string

  queues: Queues

  queueConnection: ConnectionOptions

  constructor(config: ZkWalletAccountConfig & GeneratorConfig) {
    super(config)
    this.id = config.id
    this.isActive = false
    this.usedUtxoSalt = new Set([])
    this.weiPerBytes = config.weiPrice ?? toWei('2000', 'gwei')

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
      walletQueue: new Queue(`wallet${this.id}`, {
        connection: this.queueConnection,
      }),
    }
  }

  async startWorker() {
    logger.info(`Worker started as 'wallet${this.id}'`)
    const worker = new Worker<ZkTxData,any,string>(
      `wallet${this.id}`,
      async (job: ZkTxJob) => {
        try {
          const { tx, zkTx } = job.data
          const response = await this.sendLayer2Tx(getZkTx(zkTx))
          if (response.status !== 200) {
            await this.unlockUtxos(tx.inflow)
            throw Error(await response.text())
          } else {
            logger.info(`generator/startWroker - response status is 200`)
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

    const walletScheduler = new QueueScheduler(`wallet${this.id}`, {
      connection: this.queueConnection,
    })
    logger.info(`${walletScheduler.name} scheduler on`)
  }

  async startGenerator() {
    if (!this.node.isRunning()) {
      this.node.start()
    }

    try {
      const result = await this.depositEther(
        toWei('50'),
        toWei('0.1'),
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
        const id = await fetch(`${organizerUrl}/register`, {
          method: 'post',
          body: JSON.stringify({
            role: 'wallet',
            params: {
              id: this.id,
              from: this.account?.ethAddress,
              weiPerByte: this.weiPerBytes
            }
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
      const response = await fetch(`${organizerUrl}/txs-in-queues`, {
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
          .weiPerByte(this.weiPerBytes)
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
          this.queues.mainQueue.add(`wallet${this.id}`, { tx, zkTx })
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
