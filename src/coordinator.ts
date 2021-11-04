import dns from 'dns'
import fetch from 'node-fetch'
import { TransactionReceipt } from 'web3-core'
import { Fp } from '@zkopru/babyjubjub'
import { Block, FullNode } from '@zkopru/core'
import { Coordinator } from '@zkopru/coordinator'
import { logger } from '@zkopru/utils'
import { config } from './config'
import { ProposeData, CoordinatorInfo } from './organizer/types'
import { getBase, startLogger } from './generator-utils'

startLogger('COORDINATOR_LOG')

const organizerUrl = process.env.ORGANIZER_URL ?? 'http://organizer:8080'
const coordinatorHost = process.env.COORDINATOR_HOST ?? 'coordinator'
const coordinatorPort = 8888

async function dnsLookup(hostname: string) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, (err, address) => {
      if (err) reject(err)
      resolve(address)
    })
  })
}

async function testCoodinator() {
  logger.info('stress-test/coordinator.ts - run test coodinator')
  const { hdWallet, mockupDB, webSocketProvider } = await getBase(
    config.testnetUrl,
    config.mnemonic,
    'helloworld',
  )

  // TODO: more than one coordinator
  const coordinatorAccount = await hdWallet.createAccount(0)
  const slaherAccount = await hdWallet.createAccount(1)

  const fullNode: FullNode = await FullNode.new({
    address: config.zkopruContract, // Zkopru contract
    provider: webSocketProvider,
    db: mockupDB,
    slasher: slaherAccount.ethAccount,
  })

  // Have to convert single string hostname to IP
  const coordinatorIp = await dnsLookup(coordinatorHost)

  const coordinatorConfig = {
    bootstrap: true,
    address: config.zkopruContract,
    maxBytes: 131072,
    maxBid: 20000,
    vhosts: '*',
    priceMultiplier: 48,
    publicUrls: `${coordinatorIp}:${coordinatorPort}`, // This is default params, Will be using registered coordinator address on Contract.
    port: coordinatorPort
  }

  const coordinator = new Coordinator(
    fullNode,
    coordinatorAccount.ethAccount,
    coordinatorConfig,
  )

  const registerResponse = await fetch(`${organizerUrl}/register`, {
    method: 'post',
    body: JSON.stringify({
      role: 'coordinator',
      params: {
        url: coordinatorConfig.publicUrls,
        from: coordinatorAccount.ethAddress,
        maxBytes: coordinatorConfig.maxBytes,
        priceMultiplier: coordinatorConfig.priceMultiplier,
        maxBid: coordinatorConfig.maxBid
      } as CoordinatorInfo
    }),
  })
  if (registerResponse.status !== 200) {
    logger.warn(`stress-test/coordinator.ts - registration failed on the organizer: ${await registerResponse.text()}`)
  }
  logger.info(`stress-test/coordinator.ts - coordinator registered: ${registerResponse.json()}`)

  let prevBlockHash: string = config.genesisHash
  let currentBlockHash = ''
  let proposeNum = 0
  let proposeData: ProposeData

  // pre & post processor to propose block
  const preProcessor = async (block: Block) => {
    currentBlockHash = block.hash.toString()
    proposeData = {
      timestamp: Date.now(),
      proposeNum,
      blockHash: currentBlockHash,
      parentsBlockHash: prevBlockHash,
      txcount: block.body.txs.length,
      paidFee: block.body.txs.reduce((sum, tx) => sum.add(tx.fee), Fp.from(0))
    }
    logger.info(`stress-test/coordinator.ts - proposed a new block: ${currentBlockHash}`)
    return block
  }

  const postProcessor = async (receipt: TransactionReceipt) => {
    const { status, from, transactionHash, blockNumber } = receipt
    if (status) {
      proposeData = {
        ...proposeData,
        from,
        layer1TxHash: transactionHash,
        layer1BlockNumber: blockNumber,
      }
      try {
        const response = await fetch(`${organizerUrl}/propose-blocks`, {
          method: 'post',
          body: JSON.stringify(proposeData),
        })
        if (response.status !== 200) {
          logger.warn(`stress-test/coordinator.ts - response not 200 for 'propose-blocks' : ${await response.text()}`)
        }
        prevBlockHash = currentBlockHash
        proposeNum += 1
      } catch (error) {
        logger.error(`stress-test/coordinator.ts - failed to send proposeData to organizer: ${error}`)
      }
    } else {
      logger.warn(`stress-test/coordinator.ts - propose tx reverted: ${proposeData.layer1TxHash}`)
    }
  }

  coordinator.middlewares.proposer.setPreProcessor(preProcessor)
  coordinator.middlewares.proposer.setPostProcessor(postProcessor)
  coordinator.start()
}

testCoodinator()
