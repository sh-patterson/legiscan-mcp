FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY src ./src
COPY README.md LICENSE ./

RUN npm run build \
  && npm prune --omit=dev \
  && chmod +x dist/index.js

ENV NODE_ENV=production

ENTRYPOINT ["node", "dist/index.js"]
