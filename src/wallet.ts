import fetch from 'node-fetch'
import { FullNode } from '@zkopru/core'
import { logger, sleep } from '@zkopru/utils'
import { TransferGenerator } from './generator'
import { getBase, startLogger } from './generator-utils'
import { config } from './config'
import { WalletInfo } from './organizer/types'

startLogger(`./WALLET_LOG`)

const redisIp = process.env.REDIS_IP ?? `redis`
const organizerUrl = process.env.ORGANIZER_URL ?? 'http://organizer:8080'

async function runGenerator() {
  logger.info(`stress-test/wallet.ts - wallet Initializing, get 'id' from organizer`)
  const registerResponse = await fetch(`${organizerUrl}/register`, {
    method: 'post',
    body: JSON.stringify({
      role: 'wallet',
      params: { 
        from: '0x0',
        weiPerByte: 0,
      } as WalletInfo
    }),
  })
  const registered = await registerResponse.json()
  logger.info(`stress-test/wallet.ts - wallet selected account index ${registered.id + 3}`)

  // Wait deposit sequence
  let ready = false
  logger.info(`stress-test/wallet.ts - stand by for 'can-deposit' are ready`)
  while (!ready) {
    try {
      const readyResponse = await fetch(`${organizerUrl}/can-deposit`, {
        method: 'post',
        body: JSON.stringify({
          id: registered.id,
        }),
      })
      ready = await readyResponse.json()
    } catch (error) {
      logger.error(`stress-test/wallet.ts - error on checking organizer ready: ${error}`)
    }
    await sleep(5000)
  }

  const { hdWallet, mockupDB, webSocketProvider } = await getBase(
    config.testnetUrl,
    config.mnemonic,
    'helloworld',
  )
  const walletAccount = await hdWallet.createAccount(+registered.id + 3)

  const walletNode: FullNode = await FullNode.new({
    address: config.zkopruContract, // Zkopru contract
    provider: webSocketProvider,
    db: mockupDB,
    accounts: [walletAccount],
  })

  // Assume that account index 0, 1, 2 are reserved
  // Account #0 - Coordinator
  // Account #1 - Slasher
  // Account #2 - None
  const transferGeneratorConfig = {
    hdWallet,
    account: walletAccount,
    accounts: [walletAccount],
    node: walletNode,
    erc20: [],
    erc721: [],
    snarkKeyPath: '/proj/keys',
    id: registered.id,
    redis: {
      host: redisIp,
      port: 6379,
    },
  }

  const generator = new TransferGenerator(transferGeneratorConfig)

  logger.info(`stress-test/wallet.ts - start transaction generator`)
  await generator.startGenerator()
}

runGenerator()
