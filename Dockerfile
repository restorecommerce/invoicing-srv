FROM node:14.15.5-stretch

# Create app directory
ENV HOME=/home/node
ENV APP_HOME=/home/node/invoicing-srv

# Install dependencies
RUN npm install -g npm

## SETTING UP THE APP ##
WORKDIR $APP_HOME

# Set config volumes
VOLUME $APP_HOME/cfg
VOLUME $APP_HOME/protos
ADD --chown=node . $APP_HOME
RUN chown -R node:node $HOME
USER node
RUN npm install
RUN npm run build
EXPOSE 50051
USER root
RUN GRPC_HEALTH_PROBE_VERSION=v0.3.3 && \
    wget -qO/bin/grpc_health_probe https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/${GRPC_HEALTH_PROBE_VERSION}/grpc_health_probe-linux-amd64 && \
    chmod +x /bin/grpc_health_probe
USER node
HEALTHCHECK CMD ["/bin/grpc_health_probe", "-addr=:50051"]
CMD [ "npm", "start" ]
