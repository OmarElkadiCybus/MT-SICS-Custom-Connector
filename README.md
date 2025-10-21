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

## 4. Protocol and Connector Features

### The MT-SICS Protocol

MT-SICS (Mettler Toledo Standard Interface Command Set) is a line-based ASCII protocol used to communicate with Mettler Toledo scales over a TCP or serial connection. It follows a simple request-response pattern:

1.  **Client Sends a Command**: The client (our connector) sends a command string, like `S` or `T`, terminated by a carriage return and line feed (`\r\n`).
2.  **Scale Sends a Response**: The scale processes the command and sends back an ASCII string response, also terminated by `\r\n`.

The format of the response depends on the command sent. It can be a simple acknowledgement (`Z A`), a value with status (`S S 100.0 g`), or an error code (`ES`).

### Implemented Connector Features

Our custom connector is designed to be a robust and flexible bridge between the Cybus platform and any MT-SICS-enabled scale. Here are its key features:

#### 1. Comprehensive Command Support
The connector implements the full set of commands required for both weighing and piece-counting operations, as specified in the project requirements. This allows you to:
- **Read Weight**: Get the stable (`S`) or immediate (`SI`) weight.
- **Control Tare**: Perform a tare (`T`), set a tare value manually (`TA`), or clear the tare (`TAC`).
- **Zero the Scale**: Zero the scale immediately (`ZI`) or when stable (`Z`).
- **Manage Piece Counting**: Get the piece count (`PCS`), get the piece weight (`PW`), or build a new piece reference (`REF`).
- **Control the Scale**: Reset the scale (`@`) or write text to its display (`D`).

#### 2. Robust Parsing and Error Handling
The connector's core strength lies in its intelligent response parser, which understands the nuances of the MT-SICS protocol.
- **Success Parsing**: It can parse different types of success responses, correctly extracting status (e.g., stable/unstable), numeric values, units, and serial numbers.
- **Error Handling**: It explicitly handles all documented MT-SICS error codes by **throwing exceptions**, which is a robust way to signal failure. This includes:
    - `ES`: Syntax errors
    - `EL`: Logical errors (e.g., invalid parameter)
    - `I`: Command not executable (e.g., scale is busy)
    - `+` / `-`: Overload or underload conditions

#### 3. Dual-Mode State Management

The connector tracks the scale's primary operational modes (`WEIGHING` and `COUNTING`) to mimic the behavior of the physical device. This is crucial because some commands are only relevant in a specific context.

##### Automatic Mode Switching

The connector starts in `WEIGHING` mode by default and intelligently switches its internal mode based on the commands you send. This automatic behavior is designed to be intuitive:

- **Switches to `COUNTING` mode**: When you use commands related to piece counting, the connector automatically transitions into `COUNTING` mode. These commands are:
  - `PCS` (Get piece count)
  - `PW` (Set piece weight)
  - `REF` (Build piece reference)

- **Switches to `WEIGHING` mode**: When you use commands related to standard weighing operations, the connector reverts to `WEIGHING` mode. These commands are:
  - `@` (Reset)
  - `Z` / `ZI` (Zero)
  - `T` / `TA` / `TAC` (Tare commands)

##### Explicit Mode Control (The `mode` Property)

While the automatic behavior is convenient, you can also enforce a specific mode for any given command. This provides more direct, deterministic control and is highly recommended for critical operations.

- **Purpose**: To use it, you add an optional `mode: 'COUNTING'` or `mode: 'WEIGHING'` property to any endpoint definition (`read`, `write`, or `subscribe`) in your `service.scf.yaml`. This tells the connector, "Before you execute this command, ensure you are in this mode."

- **Is it needed?**: It is not strictly required for every command, but it is best practice to use it to prevent unexpected behavior. For example, if one process uses `PCS` (switching the mode to `COUNTING`) and another process immediately tries to read the weight, the context might be wrong. By adding `mode: 'WEIGHING'` to your weight-reading endpoint, you guarantee the connector is in the correct state for that operation, regardless of what happened before.

#### 4. Subscription Support
For continuous data monitoring, the connector supports polling-based subscriptions. You can subscribe to any MT-SICS command, and the connector will periodically send the command to the scale and forward the parsed response to the Cybus platform.

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

```
```
