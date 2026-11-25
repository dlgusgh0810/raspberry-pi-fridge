FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN chown node:node /app
USER node
RUN npm ci --omit=dev --no-audit --no-fund

COPY --chown=node:node auth.js server.js ./
COPY --chown=node:node public/ ./public/

ENV HOST=0.0.0.0
EXPOSE 3000
CMD ["node", "server.js"]
