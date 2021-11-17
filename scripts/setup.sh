#!/bin/sh
if [[ ! -z "${SKIP_SETUP}" ]]; then
  echo "Skipping setup script"
  exit
fi

set -e
if [[ ! -z "${SKIP_SUBMODULE}" ]]; then
  git submodule update --init zkopru
fi
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
