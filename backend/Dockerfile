FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY src/ ./src/

RUN npm run build

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS production-deps

WORKDIR /usr/src/app

RUN addgroup -S payd && adduser -S -G payd payd \
  && chown payd:payd /usr/src/app

USER payd

COPY --chown=payd:payd package*.json ./
# These packages use lib/ or excel.js in Node; dist/ contains browser bundles.
# Remove them before committing the dependency layer, retaining all Node files
# and native bindings from the unchanged lockfile.
RUN npm ci --omit=dev \
  && rm -rf node_modules/exceljs/dist \
    node_modules/@stellar/stellar-sdk/dist \
    node_modules/@stellar/stellar-base/dist \
  && npm cache clean --force

# Match the Alpine series used by the pinned Node image. Copy only its runtime
# binary and entrypoint so npm, Yarn and C/C++ headers stay in the build stages.
FROM alpine:3.23 AS production

WORKDIR /usr/src/app

RUN apk add --no-cache libstdc++ wget \
  && addgroup -S payd && adduser -S -G payd payd \
  && chown payd:payd /usr/src/app \
  && ln -s node /usr/local/bin/nodejs

COPY --from=production-deps /usr/local/bin/node /usr/local/bin/node
COPY --from=production-deps /usr/local/bin/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --chown=payd:payd package*.json ./
COPY --from=production-deps --chown=payd:payd /usr/src/app/node_modules ./node_modules
COPY --from=builder --chown=payd:payd /usr/src/app/dist ./dist
# Public metadata served by dist/app.js; TypeScript does not copy this asset.
COPY --chown=payd:payd .well-known/stellar.toml ./.well-known/stellar.toml

USER payd

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3001}/health/live" || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
