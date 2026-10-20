FROM hyperledger/fabric-ca:1.5.22 AS ca
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=ca /usr/local/bin/fabric-ca-client /usr/local/bin/fabric-ca-client
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir -p /wallet && chown node:node /wallet
COPY src ./src
USER node
EXPOSE 8443
CMD ["node","src/server.mjs"]
