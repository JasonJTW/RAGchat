# The Next.js app (docker-compose.prod.yml). Build from the repo root:
#   docker build -f web/Dockerfile .
# NEXT_PUBLIC_* values and the /api rewrite target are fixed at build time, so
# changing them means rebuilding the image (docs/deploy.md).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
# --ignore-scripts: the root postinstall downloads Chromium for E2E, and lefthook
# installs git hooks; neither belongs in an image.
RUN npm ci --ignore-scripts --workspace web
COPY web/ web/
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ARG SERVER_URL=http://server:4000
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    SERVER_URL=$SERVER_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace web && rm -rf web/.next/cache

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --ignore-scripts --omit=dev --workspace web && npm cache clean --force
COPY --from=build /app/web/.next web/.next
COPY web/public web/public
COPY web/next.config.ts web/package.json web/
USER node
WORKDIR /app/web
EXPOSE 3000
CMD ["npx", "next", "start", "--port", "3000"]
