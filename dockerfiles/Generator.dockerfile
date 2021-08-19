FROM node:16-stretch-slim
RUN apt update
RUN apt install -y git make musl-dev golang-go sqlite g++ tmux curl jq
RUN mkdir -p /usr/share/man/man1
RUN mkdir -p /usr/share/man/man7
RUN apt install -y netcat

# Configure Go
ENV GOROOT /usr/lib/go
ENV GOPATH /go
ENV PATH /go/bin:$PATH

RUN mkdir -p ${GOPATH}/src ${GOPATH}/bin

# Install Gotty (it needs go >= 1.9)
RUN go get golang.org/dl/go1.10.7
RUN go1.10.7 download
RUN go1.10.7 get github.com/yudai/gotty

RUN apt install -y python
# Install Lerna & gyp
RUN npm install -g node-gyp-build
RUN npm install -g lerna
RUN ln -s "$(which nodejs)" /usr/bin/node
WORKDIR /generator

# Copy SNARK keys
COPY zkopru/packages/circuits/keys /proj/keys

# Copy package.json
COPY zkopru/.package-dev.json /generator/zkopru/package.json
COPY zkopru/lerna.json /generator/zkopru/lerna.json
COPY zkopru/packages/account/package.json /generator/zkopru/packages/account/package.json
COPY zkopru/packages/babyjubjub/package.json /generator/zkopru/packages/babyjubjub/package.json
COPY zkopru/packages/contracts/package.json /generator/zkopru/packages/contracts/package.json
COPY zkopru/packages/coordinator/package.json /generator/zkopru/packages/coordinator/package.json
COPY zkopru/packages/cli/package.json /generator/zkopru/packages/cli/package.json
COPY zkopru/packages/core/package.json /generator/zkopru/packages/core/package.json
COPY zkopru/packages/database/package.json /generator/zkopru/packages/database/package.json
COPY ./package.json /generator/package.json
COPY zkopru/packages/transaction/package.json /generator/zkopru/packages/transaction/package.json
COPY zkopru/packages/tree/package.json /generator/zkopru/packages/tree/package.json
COPY zkopru/packages/utils/package.json /generator/zkopru/packages/utils/package.json
COPY zkopru/packages/zk-wizard/package.json /generator/zkopru/packages/zk-wizard/package.json
COPY zkopru/yarn.lock /generator/zkopru/yarn.lock
COPY ./yarn.lock /generator/yarn.lock

# Copy dist
COPY zkopru/packages/account/dist /generator/zkopru/packages/account/dist
COPY zkopru/packages/babyjubjub/dist /generator/zkopru/packages/babyjubjub/dist
COPY zkopru/packages/contracts/dist /generator/zkopru/packages/contracts/dist
COPY zkopru/packages/coordinator/dist /generator/zkopru/packages/coordinator/dist
COPY zkopru/packages/core/dist /generator/zkopru/packages/core/dist
COPY zkopru/packages/cli/dist /generator/zkopru/packages/cli/dist
COPY zkopru/packages/database/dist /generator/zkopru/packages/database/dist
COPY ./dist /generator/dist
COPY zkopru/packages/transaction/dist /generator/zkopru/packages/transaction/dist
COPY zkopru/packages/tree/dist /generator/zkopru/packages/tree/dist
COPY zkopru/packages/utils/dist /generator/zkopru/packages/utils/dist
COPY zkopru/packages/zk-wizard/dist /generator/zkopru/packages/zk-wizard/dist
#RUN lerna clean -y --loglevel silent && lerna bootstrap

RUN yarn install

EXPOSE 8888
