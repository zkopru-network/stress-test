# Drone CI setup

## setup drone server as docker

For running drone CI, you need `Server` and `Runner` node.

- the `Server` for web ui for user(or developer)

- the `Runner` is a worker for running steps which follows specified in `.drone.yml`.

You can get more info about drone-ci in [docs.drone.io](https://docs.drone.io/)

For your convenience, we created a compose file in `.drone-ci` directory. you have to set some environments variables for running with this compose file.

You must set those variable for using the `docker-compose.yml` in `.drone-ci`.

- DRONE_GITHUB_CLIENT_ID
- DRONE_GITHUB_CLIENT_SECRET
- DRONE_USER_CREATE=username:admin,machine:false,admin:true
- DRONE_RPC_SECRET
- DRONE_SERVER_HOST
- DRONE_SERVER_PROTO
- DRONE_RPC_HOST
- DRONE_RPC_PROTO

Please see links for set these variables above.

- [Server setup with github as provider](https://docs.drone.io/server/provider/github/)
- [Runner setup with docker on linux](https://docs.drone.io/runner/docker/installation/linux/)

```shell
 stress-test/.drone-ci# docker-compose up -d
```

## Prepare for stress-test

If you are going to setup with drone CI with `.drone-ci/.drone.yml`. you need `zkopru/git` image, which has registered ssh key on github.

This image for pushing result data on the last step of drone ci configuration.

You can build `zkopru/git` image below command.

```shell
 stress-test# docker build -f dockerfiles/Git.dockerfile --build-arg ID_RSA --build-arg EMAIL=bot@zkopru.network --build-arg NAME="[ Bot ] Result Pusher" -t zkopru/git .
```

Note that, the `ID_RSA` variable is generated rsa key from your machine. than must register it `zkopru-network/stress-test` repo as `Deploy Keys`.

## Repository Setup

Now, you can setup on your drone `Server` web UI.

Please connect url, which you set `DRONE_SERVER_HOST` then activate `stress-test` repository.

You must modify configuration path in setting.

> change path from `.drone.yml` to `.drone-ci/.drone.yml` like below.

![setting](https://raw.githubusercontent.com/zkopru-network/stress-test/develop/.drone-ci/setup_respository.png)

also, you need to set secret as name `wallet_number`, this variable(number) will be use how many wallet node up when start testing. plase set at least `1`.

this `.drone-ci/.drone.yml` only triggered by `zkopru` repository. In other words, you must activate  `zkopru` repository on the same `Server`.
