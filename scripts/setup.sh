#!/bin/sh

set -e

git submodule update --init zkopru

cd zkopru

yarn
yarn build

yarn images pull circuits
cd packages/dataset
yarn load-keys
cd ../circuits
yarn setup
yarn build-keys
yarn postbuild-keys
