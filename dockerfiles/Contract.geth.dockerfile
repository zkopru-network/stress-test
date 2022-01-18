FROM ethereum/client-go:v1.10.13 AS base

# Deploy contract on geth private network
FROM node:16-alpine
COPY --from=base /usr/local/bin/geth /usr/local/bin/geth
RUN npm install -g truffle ganache-cli --unsafe-perm=true --allow-root 
    # apt update && apt install -y python make g++ git curl

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
COPY ./scripts/run_geth.sh /proj/run_geth.sh
CMD ["geth", "--dev", "--networkid", "20200406", "--datadir", "data", "--rpc", "--rpcaddr", "0.0.0.0", "--rpccorsdomain", "*","--http.api", "eth,net,web3,personal,miner", "--nousb"]
