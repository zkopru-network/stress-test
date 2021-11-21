FROM node:14-alpine
RUN apk add --no-cache --virtual .gyp \
        python \
        make \
        g++ \
    && npm install -g truffle ganache-cli --unsafe-perm=true --allow-root \
    && apk del .gyp
RUN apk add git
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
RUN ganache-cli --db=/data -i 20200406 -p 5000 --gasLimit 12000000 --deterministic --host 0.0.0.0 & sleep 5 && truffle migrate --network testnet
CMD ganache-cli --db=/data -b 5 -i 20200406 -p 5000 --gasLimit 12000000 --deterministic --host 0.0.0.0
