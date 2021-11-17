# Zkopru Stress Tester

## Installation

- Setup zkopru repo

  ```shell
  stress-test# yarn
  ```

   `preinstall` script will clone zkopru repo by submodule then setup

- Build `stress-test` source

  ```shell
  stress-test# yarn build
  ```

## Run Stress Testing

- Run with docker-compose

  ```shell
  stress-test# docker-compose -p zkopru -f compose/docker-compose.localtest-geth.yml up
  ```

  > A `-p` flag argument is optional. It is used to the prefix of docker conatiner name.<br>
  > In this case, all container name starts with 'zkopru'

----

## Drone CI Setup

If you are going to setup with drone CI with `.drone.yml`. you need `zkopru/git` image, which has registered ssh key on github.

This image for pushing result data on the last step of drone ci configuration.

You can build `zkopru/git` image below command.

```shell
 stress-test# docker build -f dockerfiles/Git.dockerfile --build-arg ID_RSA --build-arg EMAIL=bot@zkopru.network --build-arg NAME="[ Bot ] Result Pusher" -t zkopru/git .
```

Note that, the `ID_RSA` variable is generated rsa key from your machine. than must register it `zkopru-network/stress-test` repo as `Deploy Keys`.
