FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY demo-api ./demo-api
COPY config ./config
COPY test ./test
EXPOSE 3000
CMD ["npm","run","demo"]
