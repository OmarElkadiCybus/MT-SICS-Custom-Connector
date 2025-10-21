ARG BASEIMAGE_VERSION=1.10.2

# First stage: Install dependencies
FROM node:18 AS builder

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY ./package.json ./src/protocols/mtsics/package.json
WORKDIR /app/src/protocols/mtsics
RUN npm install --production

# Second stage: Production image
FROM registry.cybus.io/cybus/protocol-mapper-base:${BASEIMAGE_VERSION}

WORKDIR /app

# Copy only the necessary parts from the builder stage
COPY --from=builder /app/src/protocols/mtsics/node_modules ./src/protocols/mtsics/node_modules
COPY ./src ./src/protocols/mtsics
COPY ./package.json ./src/protocols/mtsics/package.json

ENTRYPOINT ["scripts/entrypoint.sh"]