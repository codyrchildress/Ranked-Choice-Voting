FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

ENV NODE_ENV=production \
    PORT=3000 \
    RCV_DB_PATH=/data/runoff.db

RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000

USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
