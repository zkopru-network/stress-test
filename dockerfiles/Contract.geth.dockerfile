FROM ethereum/client-go:v1.10.3 AS base

# Deploy contract on geth private network
FROM node:14-alpine
COPY --from=base /usr/local/bin/geth /usr/local/bin/geth
RUN apk add --no-cache --virtual .gyp \
    python \
    make \
    g++ \
    && npm install -g truffle --unsafe-perm=true --allow-root \
    && apk del .gyp
RUN apk add git curl
WORKDIR /proj
COPY ./zkopru/packages/contracts/package.json /proj/package.json
# Stub a package json for @zkopru/utils so yarn install works
RUN mkdir /utils && echo '{"version": "0.0.0"}' > /utils/package.json
RUN yarn install
COPY ./zkopru/packages/contracts/contracts /proj/contracts
COPY ./zkopru/packages/contracts/utils /proj/utils
COPY ./zkopru/packages/contracts/migrations /proj/migrations
COPY ./zkopru/packages/contracts/truffle-config.js /proj/truffle-config.js
RUN truffle compile 
EXPOSE 5000
COPY ./zkopru/packages/contracts/keys /proj/keys
COPY ./genesis.json /proj/genesis.json
COPY ./testnet-key /proj/testnet-key
COPY ./testnet-pass /proj/testnet-pass
COPY ./run_geth.sh /proj/run_geth.sh
CMD ["geth", "--dev", "--networkid", "20200406", "--datadir", "data", "--rpc", "--rpcaddr", "0.0.0.0", "--rpccorsdomain", "*","--http.api", "eth,net,web3,personal,miner", "--nousb"]
