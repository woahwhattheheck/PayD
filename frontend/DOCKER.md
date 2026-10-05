# Frontend container

From the repository root:

```sh
docker build --pull -t payd-frontend:local -f frontend/Dockerfile frontend
docker run --rm -p 8080:80 payd-frontend:local
```

The Node 22 build stage runs the existing locked dependency install and
`npm run build`; only Vite's `dist` output enters the nginx Alpine slim runtime.
Port 80 matches the Kubernetes and Helm frontend service/probe configuration.
Build errors are not suppressed. No backend, database, or provider runs in this
image: route API requests to the backend through the existing ingress. Vite's
local development proxy is not part of a production static server.

Vite embeds public configuration at build time. Pass the required
`PUBLIC_STELLAR_NETWORK`, `PUBLIC_STELLAR_NETWORK_PASSPHRASE`,
`PUBLIC_STELLAR_RPC_URL`, and `PUBLIC_STELLAR_HORIZON_URL` using `--build-arg`.
Do not pass secrets as build arguments. Local `.env` files are excluded from the
build context; runtime `docker run -e` values do not rewrite the built application.

## Focused acceptance checks

```sh
# Issue #539 requires the uncompressed local image to be below 50 MB.
bytes=$(docker image inspect payd-frontend:local --format '{{.Size}}')
test "$bytes" -lt 50000000

docker run --rm payd-frontend:local nginx -t
curl -fsSI http://localhost:8080/index.html  # Cache-Control: no-store
curl -fsSI http://localhost:8080/dashboard  # SPA fallback; no-store
curl -sSI http://localhost:8080/assets/missing.js  # 404; no immutable cache
# Request a real /assets/<hashed-name>.js from index.html:
# Cache-Control: public, max-age=31536000, immutable
```

`index.html` and SPA fallbacks are never stored. Vite's hashed `/assets/` files
are immutable for one year; other public files must revalidate. Check the image
size after building, since application assets and upstream image tags can grow.
