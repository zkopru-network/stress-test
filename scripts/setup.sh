#!/bin/sh

set -e

#git clone https://github.com/zkopru-network/zkopru.git zkopru

cd zkopru
#yarn
#yarn build:ts

yarn images pull circuits
cd packages/dataset
yarn load-keys
cd ../circuits
yarn setup
yarn build-keys
yarn postbuild-keys
