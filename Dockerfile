### Build
FROM node:20.8.0-alpine3.18 as build
ENV NO_UPDATE_NOTIFIER=true

RUN apk add --no-cache git
RUN apk add g++ make python3

USER node
ARG APP_HOME=/home/node/srv
WORKDIR $APP_HOME

COPY package.json package.json
COPY package-lock.json package-lock.json

RUN npm ci

COPY --chown=node:node . .

RUN npm run build


### Deployment
FROM node:20.8.0-alpine3.18 as deployment

ENV NO_UPDATE_NOTIFIER=true

USER node
ARG APP_HOME=/home/node/srv
WORKDIR $APP_HOME

COPY package.json package.json
COPY package-lock.json package-lock.json

COPY filter_ownership.aql $APP_HOME/filter_ownership.aql
COPY cfg $APP_HOME/cfg

COPY --from=build $APP_HOME/lib $APP_HOME/lib

EXPOSE 50051

USER root
USER node

CMD [ "npm", "start" ]
