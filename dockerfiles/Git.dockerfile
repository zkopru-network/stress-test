FROM alpine

RUN apk update && apk add openssh-client git

ARG ID_RSA
ARG EMAIL
ARG NAME

# Adding SSH keys
RUN mkdir -p ~/.ssh \
  && echo "${ID_RSA}" > ~/.ssh/id_rsa \
  && chmod 0600 ~/.ssh/id_rsa \
  && touch ~/.ssh/known_hosts \
  && ssh-keyscan github.com >> ~/.ssh/known_hosts

# Configure git
RUN git config --global url.ssh://git@github.com/.insteadOf https://github.com/ \
 && git config --global push.default simple \
 && git config --global user.email "${EMAIL}" \
 && git config --global user.name "${NAME}"
