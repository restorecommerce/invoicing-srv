### Build
FROM node:24.10.0-alpine3.22 AS build
ENV NO_UPDATE_NOTIFIER=true

USER node
ARG APP_HOME=/home/node/srv
WORKDIR $APP_HOME

COPY package.json package.json
COPY package-lock.json package-lock.json

RUN npm ci

COPY --chown=node:node . .

RUN npm run build


### Deployment
FROM node:24.10.0-alpine3.22 AS deployment

ENV NO_UPDATE_NOTIFIER=true

USER node
ARG APP_HOME=/home/node/srv
WORKDIR $APP_HOME

COPY ./cfg $APP_HOME/cfg
COPY ./queries $APP_HOME/queries
COPY ./templates $APP_HOME/templates

COPY --from=build $APP_HOME/lib $APP_HOME/lib

EXPOSE 50051

CMD [ "node", "lib/start.cjs" ]
