# Documentation: MT-SICS Custom Connector

## 1. Overview

This document outlines the implementation of a Cybus custom connector designed to interface with Mettler Toledo weighing scales using the MT-SICS (Mettler Toledo Standard Interface Command Set) protocol. The primary goal was to ensure compliant TCP communication, robust command handling, and accurate response parsing.

## 2. Implementation Details

### `src/Client.js`

This file implements a generic TCP client responsible for establishing and maintaining the connection with the MT-SICS scale. Key features include:
*   **TCP Communication**: Handles connection, data transmission, and reception.
*   **Command Queuing**: Ensures commands are sent sequentially, waiting for a response before sending the next, as required by the MT-SICS protocol.
*   **Response Buffering**: Accumulates incoming data and processes it line-by-line, handling fragmented or concatenated responses.
*   **CR LF Termination**: All commands sent are terminated with Carriage Return and Line Feed (`\r\n`) for MT-SICS compliance.

### `src/MtsicsConnection.js`

This file contains the core logic of the Cybus custom connector, extending the base `Connection` class. It integrates the `Client.js` for communication and implements MT-SICS specific logic:
*   **Client Integration**: Utilizes the `MtsicsClient` for all TCP interactions.
*   **Command Handling**: Implements `handleRead` and `handleWrite` methods to send MT-SICS commands (e.g., 'S' for stable weight, 'Z' for zero).
*   **Response Parsing (`_parseMtsicsResponse`)**: Transforms raw MT-SICS string responses into structured JSON objects, extracting command, status, value, and unit information. It also handles MT-SICS specific error codes (ES, EL, I).

### `src/MtsicsConnection.json`

This schema defines the configuration parameters for the `MtsicsConnection`, including connection details like host and port.

## 3. Testing

A comprehensive test suite is provided to ensure the connector's functionality and MT-SICS compliance.
*   **Unit Tests (`test/unit.js`)**: Verifies individual components and the overall integration using a mock TCP server (`test/mock-scale-server.js`).
*   **Mock Cybus Base (`test/mock-cybus-base.js`, `test/mocks/Connection.js`)**: Provides mock implementations of Cybus base classes to allow `MtsicsConnection` to be tested outside the full Cybus environment.

## 4. MTsim Headless Scale Simulator

The project includes a vendored [MTsim](https://github.com/jonggun33/MTsim) simulator (`simulators/MTsim/`) with a headless wrapper (`simulators/mtsim_headless_server.py`). This simulator provides a TCP server that speaks MT-SICS and an HTTP control API for adjusting its state.

**Recent Fix**: The `simulators/mtsim_headless_server.py` was updated to correctly process MT-SICS commands and return appropriate responses, rather than simply echoing received data. This ensures accurate simulation of scale behavior.

### How to Run the Simulator

You can launch the simulator via Docker Compose:

```bash
# Start the simulator
docker compose -f docker-compose.simulator.yaml up
```

*   MT-SICS TCP endpoint: `localhost:4305`
*   HTTP control API: `http://localhost:8081/state`

### Controlling the Simulator

Use the HTTP API to inspect or manipulate the simulated scale state:

```bash
# Inspect current simulator state
curl http://localhost:8081/state

# Set weight to 150 g and mark it as stable
curl -X POST http://localhost:8081/state \
  -H 'Content-Type: application/json' \
  -d '{ "weight": 150, "stable": true }'
```

## 5. Agent Deployment

The connector is deployed as a Docker container.

### Building the Agent

```bash
# This will build the image and tag it as 'mt-sics-custom-connector-agent'
docker compose build
```

### Running the Agent

Ensure `CYBUS_MQTT_HOST`, `CYBUS_MQTT_PORT`, `CYBUS_USER`, `CYBUS_PASSWORD`, and `CYBUS_AGENT_NAME` are correctly configured in `docker-compose.yaml`.

```bash
# Start the agent service in detached mode
docker compose up -d
```

### Agent Authorization

On the first run, authorize the agent in the Connectware UI by finding the client with `MtsicsAgent` and its pairing ID (from `docker logs mt-sics-custom-connector-agent-1`).

```
```