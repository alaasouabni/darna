FROM --platform=$BUILDPLATFORM node:20.18-bullseye-slim AS proto-builder
WORKDIR /usr/src
COPY messages/package-lock.json messages/package.json ./
RUN npm ci
COPY messages .
COPY libs ./../libs
RUN npm run tag-version && npm run ts-proto

FROM node:20.18-bullseye-slim AS builder
WORKDIR /usr/src

COPY package.json package-lock.json ./
COPY admin/api/package.json admin/api/package.json
COPY libs/messages/package.json libs/messages/package.json
COPY libs/map-editor/package.json libs/map-editor/package.json
COPY libs/math-utils/package.json libs/math-utils/package.json
COPY libs/shared-utils/package.json libs/shared-utils/package.json
COPY libs/store-utils/package.json libs/store-utils/package.json

RUN npm ci --workspace=@workadventure/admin-api

COPY libs ./libs
COPY --from=proto-builder /usr/libs/messages/src ./libs/messages/src
COPY admin/api ./admin/api
WORKDIR /usr/src/admin/api
RUN npm run generate

FROM node:20.18-bullseye-slim
WORKDIR /usr/src
ENV NODE_ENV=production
COPY --from=builder /usr/src /usr/src
WORKDIR /usr/src/admin/api
EXPOSE 3100
CMD ["npm", "run", "start"]
