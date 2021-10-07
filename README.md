# Transaction Generator

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
