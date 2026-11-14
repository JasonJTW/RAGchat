# The Express server (docker-compose.prod.yml). Build from the repo root:
#   docker build -f server/Dockerfile .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
# --ignore-scripts: the root postinstall downloads Chromium for E2E, and lefthook
# installs git hooks; neither belongs in an image.
RUN npm ci --ignore-scripts --workspace server
COPY server/ server/
RUN npm run build --workspace server

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --ignore-scripts --omit=dev --workspace server && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY server/drizzle server/drizzle
USER node
WORKDIR /app/server
EXPOSE 4000
# Migrates the database, then listens on PORT (default 4000).
CMD ["node", "dist/index.js"]
