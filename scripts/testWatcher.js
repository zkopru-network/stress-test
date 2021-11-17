const fs = require('fs')
const Docker = require('dockerode');
const fetch = require('node-fetch')

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

function sleep(ms) {
  return new Promise(res => {
    setTimeout(res, ms)
  })
}

async function getContainersInfo(networkName) {
  const containers = await docker.listContainers({ all: true })
  return containers
    .filter(container => { return container.HostConfig.NetworkMode == networkName })
    .map(container => {
      const { Id, Names, Labels, State } = container
      const parsedName = Names[0].split('_')
      return {
        name: Names[0],
        service: Labels['com.docker.compose.service'],
        containerNumber: Labels['com.docker.compose.container-number'],
        Id,
        State
      }
    })
}

(async () => {
  // get test info
  const infoResponse = await fetch(`http://organizer:8080/info`, {
    method: 'get',
  })
  const testInfo = await infoResponse.json()
  console.log(testInfo)

  // Initialize Testing Check variables 
  let FailedContainers
  let SinceLastProposal = 0
  let TestingPeriod = 0

  do {
    await sleep(10000)

    // Should be match in docker-compose network name 'stress-test'
    const testContainers = await getContainersInfo("stress-test")
    if (testContainers.length == 0) {
      console.log(`No containers running on "stress-test" network, that means something wrong`)
      break;
    }

    FailedContainers = testContainers.filter(container => {
      const isRunning = container.State != 'running'
      const isNotWallet = container.service != 'wallet' // Exclude wallet containers, It's scalable for testing
      return (isRunning && isNotWallet)
    })

    // Check Last Propose Block
    const proposeResponse = await fetch(`http://organizer:8080/proposed-data?limit=1`, {
      method: 'get',
    })
    const lastProposed = await proposeResponse.json()
    if (lastProposed.length != 0) {
      SinceLastProposal = new Date().getTime() - lastProposed[0].timestamp
      console.log(`${Math.floor(SinceLastProposal / 1000)} seconds from last proposal block submitted`)
    } else {
      console.log(`Not proposed yet`)
    }

    // For checking test operation time - No more testing over 7 days.
    TestingPeriod = new Date().getTime() - testInfo.operation.startTime 

    // Check end condition
    if (FailedContainers.length > 0) {
      console.log(`Failed - Testing container failed: ${FailedContainers}`)
      break
    } else if (SinceLastProposal > 2 * 3600 * 1000) {
      console.log(`Failed - No proposal within two hours.`)
      break
    } else if (TestingPeriod > 7 * 24 * 3600 * 1000 ) {
      console.log(`Success - We are fully tested (7 days) .`)
      break
    }
  } while (true)
  
  // Download Testing Result
  try {
    const resultResponse = await fetch(`http://organizer:8080/result`)
    fs.writeFileSync(`result.json`, await resultResponse.text())
    console.log(`Completed result download`)
  } catch (error) {
    console.log(`Error - while on download data: ${error}`)
  }

})()
