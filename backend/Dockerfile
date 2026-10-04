FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY src/ ./src/

RUN npm run build

FROM node:20-alpine AS production

WORKDIR /usr/src/app

# wget is not on the slim Alpine image; HEALTHCHECK needs it
RUN apk add --no-cache wget \
  && addgroup -S payd && adduser -S -G payd payd \
  && chown payd:payd /usr/src/app

# Create runtime files with their final owner instead of copying the complete
# dependency tree into another layer with a recursive chown.
USER payd

COPY --chown=payd:payd package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder --chown=payd:payd /usr/src/app/dist ./dist

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3001}/health/live" || exit 1

CMD ["node", "dist/index.js"]
