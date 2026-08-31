FROM node:22.18.0-bookworm-slim

ARG CODEX_VERSION=0.151.0

RUN npm install --global "@openai/codex@${CODEX_VERSION}" \
  && npm cache clean --force

WORKDIR /opt/fork-fighter-worker
COPY bin ./bin
COPY lib ./lib

RUN mkdir -p contract runtime /home/node/.codex \
  && chmod 0555 bin/propose bin/test-worker \
  && chown -R node:node /opt/fork-fighter-worker /home/node/.codex \
  && ./bin/test-worker --image-build

USER node
ENV CODEX_HOME=/home/node/.codex

CMD ["sleep", "infinity"]
