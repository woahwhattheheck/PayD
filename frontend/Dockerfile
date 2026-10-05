# Build from the repository root:
# docker build -t payd-frontend -f frontend/Dockerfile frontend
FROM node:22-alpine AS build
WORKDIR /app

# Copy the workspace sources before npm ci so local packages are available too.
COPY . .
RUN npm ci --legacy-peer-deps

# These are public browser configuration, never credentials. Vite substitutes
# them at build time; setting container environment variables cannot change dist.
ARG PUBLIC_STELLAR_NETWORK
ARG PUBLIC_STELLAR_NETWORK_PASSPHRASE
ARG PUBLIC_STELLAR_RPC_URL
ARG PUBLIC_STELLAR_HORIZON_URL
RUN npm run build

FROM nginx:stable-alpine-slim AS runtime
RUN rm -rf /usr/share/nginx/html/*
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
