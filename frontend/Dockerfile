FROM node:22-alpine AS build

WORKDIR /app
COPY . .
RUN npm ci --legacy-peer-deps
RUN npm run build

FROM nginx:stable-alpine-slim AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
