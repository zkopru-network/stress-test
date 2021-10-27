import { Fp } from '@zkopru/babyjubjub'

// TODO: refactor this funcs

type blockStat = {
  blockNumber: number,
  gasLimit: number,
  gasUsed: number
}

// Configuration
export function processConfigurationData(data) {
  const { chainId, nodeInfo } = data.operationInfo.testnetInfo
  const { blockData } = data.layer1
  
  // Calculate average block gas limit
  const sumGasLimit = blockData.reduce((sum: Fp, data: blockStat) => sum.add(Fp.from(data.gasLimit)), Fp.from(0))
  const avgBlockGasLimit = sumGasLimit.div(Fp.from(blockData.length)).toNumber()
  
  const layer1 = { chainId, nodeInfo, avgBlockGasLimit }
  
  return {
    layer1,
    zkopruConfig: data.layer1.zkopruConfig,
    coordinatorConfig: data.coordinatorInfo
  }
}

// TPS
export function processProposeData(data) {
  const { proposeData } = data.layer1
  let firstProposeTime = 0

  const txCount = {
    total: 0,
    last24h: 0,
    last01h: 0
  }

  let lastProposeBlocks: any[] = []

  const lastProposeTime = proposeData.reduce((acc, propose) => {
    return Math.max(acc, propose.timestamp)
  }, 0)

  for (const propose of proposeData) {
    if (propose.proposeNum == 0) { firstProposeTime = propose.timestamp }

    const diffTime = propose.timestamp - lastProposeTime

    if (diffTime <= (24 * 3600 * 1000)) {
      txCount.last24h += propose.txcount
    } else if (diffTime <= (3600 * 1000)) {
      txCount.last01h += propose.txcount
    }
    txCount.total += propose.txcount

    // Keep last proposed block data limited in 10
    lastProposeBlocks.unshift(propose)
    lastProposeBlocks.length = 10
  }

  return {
    performance: {
      firstProposeTime,
      lastProposeTime,
      txCount
    },
    recentProposedBlocks: [...lastProposeBlocks]
  }
}

// Coordinator
export function processCoordinatorData(data) {
  const { coordinatorInfo: coordinatorData } = data
  const { proposeData, auctionData } = data.layer1

  let lastProposedNum = 0
  const coordinatorInfo = {}

  coordinatorData.map((coordinator) => {
    coordinatorInfo[coordinator.from.toLowerCase()] = {
      name: `coordinator_${coordinator.id}`,
      proposedCount: 0,
      totalTxCount: 0,
      totalPaidFee: Fp.from(0),
      totalSpentForBid: Fp.from(0) 
    }
  })

  // accumulated from propose data
  proposeData.forEach(propose => {
    const { totalPaidFee } = coordinatorInfo[propose.from]

    coordinatorInfo[propose.from].proposedCount += 1
    coordinatorInfo[propose.from].totalTxCount += propose.txcount
      coordinatorInfo[propose.from].totalPaidFee = totalPaidFee.add(Fp.from(propose.paidFee))
      lastProposedNum = Math.max(lastProposedNum, propose.layer1BlockNumber)
  })

  /* caculating totalSpentForBid
     Only accumulated bidding fee which has layer1 inlude
  */
  const openRounds = Object.keys(auctionData)
  const recentAuctionData: any[] = []

  openRounds.forEach(roundNum => {
    const { highestBid, bidHistory } = auctionData[roundNum]

    if (highestBid.startBlock <= lastProposedNum) {
      const from = highestBid.bidder.toLowerCase()
      const { totalSpentForBid } = coordinatorInfo[from]
      coordinatorInfo[from].totalSpentForBid = totalSpentForBid.add(Fp.from(highestBid.bidAmount))
    }

    recentAuctionData.unshift({ highestBid, roundNum, totalBidCount: bidHistory.length })
    recentAuctionData.length = 10
  })

  return { recentAuctionData, coordinatorInfo }
}

// Layer1 Blocks
export function processTxData(data) {
  const { txData, blockData } = data.layer1
  const txHashes = txData.map(data => { return Object.keys(data)[0] })

  const lastZkopruTxIncluded: any[] = []

  let pointer = blockData.length - 1
  while (lastZkopruTxIncluded.length < 10) {
    if (pointer == 0) break // No more found
    const block = blockData[pointer]
    let zkopruTxCount = 0

    for (const tx of block.transactions) {
      if (txHashes.includes(tx)) {
        zkopruTxCount += 1
      }
    }
    if (zkopruTxCount != 0) lastZkopruTxIncluded.push({ ...block, zkopruTxCount })
    pointer -= 1
  }

  return lastZkopruTxIncluded
}
