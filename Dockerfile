ARG BASEIMAGE_VERSION=1.10.2
FROM registry.cybus.io/cybus/protocol-mapper-base:${BASEIMAGE_VERSION}

WORKDIR /app
COPY ./src ./src/protocols/mtsics
COPY ./package.json ./src/protocols/mtsics
COPY ./package-lock.json ./src/protocols/mtsics

WORKDIR /app/src/protocols/mtsics
RUN npm install

ARG NODE_ENV=production
RUN if [ "$NODE_ENV" = "dev" ] ; then npm install --dev ; fi

WORKDIR /app
ENTRYPOINT ["scripts/entrypoint.sh"]
