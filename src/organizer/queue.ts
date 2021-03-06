import { Job, Queue, QueueScheduler, Worker } from 'bullmq'
import { RawTx, ZkTx } from '@zkopru/transaction'
import { Fp } from '@zkopru/babyjubjub'
import { OrganizerConfig } from './context'

/*
Organizer Queue has two types of queue, 'main' and 'sub'.

The main queue always accepts ZkTx from the wallets,

then following the current rate, forwards to the 'sub' queue which has a worker with the rate-limiting.

Let assume that there are 2 sub queues, one has 10 tps rate, another one has 1 tps rate.

If select 10 tps rate, the main queue is going to forward zktx to the sub queue which has 10 tps rate worker

- 10 tps rate
  [ generator ]   [            organizer            ]   [ generator ]
  Wallet1(ZkTx) → Main-Queue → Sub-Queue(10 tps rate) → Wallet1-Queue
  Wallet2(ZkTx) ⬈              Sub-Queue( 1 tps rate) ⬊ Wallet2-Queue

- 1 tps rate
  Wallet1(ZkTx) → Main-Queue   Sub-Queue(10 tps rate) ⬈ Wallet1-Queue
  Wallet2(ZkTx) ⬈            ⬊ Sub-Queue( 1 tps rate) → Wallet2-Queue 

bullmq does not working with newly created queue or workers after initiated
*/

export type ZkTxData = { tx: RawTx; zkTx: ZkTx }

export type ZkTxJob = Job<ZkTxData, any, string>
export type ZkTxQueue = Queue<ZkTxData, any, string>
export type ZkTxWorker = Worker<ZkTxData, any, string>

interface Queues {
  main: ZkTxQueue
  sub: { [key: string]: ZkTxQueue }
  wallet: { [key: string]: ZkTxQueue }
}

interface Workers {
  main: ZkTxWorker
  sub: { [key: string]: ZkTxWorker }
}

interface Schedulers {
  main: QueueScheduler
  sub: { [key: string]: QueueScheduler }
}

export class OrganizerQueue {
  private currentQueue: string // currentRate

  queues: Queues

  workers: Workers

  scheduler: Schedulers

  config: OrganizerConfig

  queueData: {
    [walletName: string]:
    {
      txCount: number,
      spentFee: Fp
    }
  }

  constructor(config: OrganizerConfig) {
    this.config = config

    const subQueues = {}
    const subWorkers = {}
    const subScheduler = {}

    const { redis: connection } = config.node

    for (const rate of config.rates) {
      const queueName = rate.name ?? rate.max.toString()
      subQueues[queueName] = new Queue<ZkTxData, any, string>(queueName, {
        connection,
      })

      subWorkers[queueName] = new Worker(queueName,
        async (job: ZkTxJob) => {
          this.queues.wallet[job.name].add(job.name, job.data)
        },
        {
          limiter: { max: rate.max, duration: rate.duration ?? 1000 },
          connection,
        },
      )

      subWorkers[queueName].on('completed', (job: Job) => {
        const { txCount, spentFee } = this.queueData[job.name]
        this.queueData[job.name].txCount = txCount + 1 // TODO : go to rate worker  
        this.queueData[job.name].spentFee = spentFee.add(Fp.from(job.data.zkTx.fee.toString()))
      })

      subScheduler[queueName] = new QueueScheduler(queueName, { connection })
    }

    const defaultRate = this.config.rates[0]

    this.currentQueue = defaultRate.name ?? defaultRate.max.toString()

    this.queueData = {}

    this.queues = {
      main: new Queue('mainQueue', { connection }),
      sub: subQueues,
      wallet: {},
    }

    this.workers = {
      main: new Worker<ZkTxData, any, string>(
        'mainQueue',
        async (job: ZkTxJob) => {
          this.queues.sub[this.currentQueue].add(job.name, job.data)
        },
        { connection },
      ),
      sub: subWorkers,
    }

    this.scheduler = {
      main: new QueueScheduler('mainQueue', { connection }),
      sub: subScheduler,
    }
  }

  currentRate = () => {
    const { limiter } = this.workers.sub[this.currentQueue].opts
    return {
      queueName: this.currentQueue,
      max: limiter?.max,
      duration: limiter?.duration,
      targetTPS: (limiter!.max * 1000) / limiter!.duration,
    }
  }

  selectRate = (queue: string | number) => {
    const queueName = queue.toString()
    if (!Object.keys(this.queues.sub).includes(queueName)) {
      return new Error(`There are not exist the queueName ${queueName}`)
    }
    const previousQueue = this.currentQueue
    this.currentQueue = queueName
    return { previous: previousQueue, current: this.currentQueue }
  }

  addWalletQueue = (walletName: string) => {
    this.queues.wallet[walletName] = new Queue(walletName, {
      connection: this.config.node.redis,
    })
    this.queueData[walletName] = {
      txCount: 0,
      spentFee: Fp.from(0)
    }
    return Object.keys(this.queues.wallet)
  }

  jobsInQueue = async (queueName: string) => {
    const jobCount = await this.queues.sub[queueName].getJobCounts(
      'wait',
      'active',
      'delayed',
    )
    return jobCount.wait + jobCount.active + jobCount.delayed
  }

  allRemainingJobs = async () => {
    let remainJobs = 0
    for (const queueName of Object.keys(this.queues.sub)) {
      remainJobs += await this.jobsInQueue(queueName)
    }
    return remainJobs
  }
}
