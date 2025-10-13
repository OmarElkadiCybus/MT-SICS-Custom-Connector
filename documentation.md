# Documentation: MT-SICS Custom Connector

## 1. Overview

The primary goal of these changes was to make the Cybus custom connector compliant with the MT-SICS protocol for Mettler Toledo weighing scales, as defined in the project requirements.

The original connector code used a custom TCP communication protocol that was incompatible with MT-SICS. The modifications detailed below replace this custom protocol with a compliant implementation and add the necessary business logic for data polling, parsing, and formatting, while keeping changes to the original codebase minimal.

## 2. File-by-File Changes

### `src/Client.js`

*   **Change**: The original file was replaced with a new implementation for an MT-SICS client.
*   **Why**: The original protocol used `<START>`/`<END>` tags and was incompatible with the MT-SICS standard, which requires commands to be terminated with a Carriage Return and Line Feed (`CR LF`).
*   **Details**:
    *   The new client sends all commands terminated with `CR LF`.
    *   It parses incoming data from the TCP stream line-by-line.
    *   A command queue was implemented to ensure that commands are sent one at a time (FIFO), waiting for a response before sending the next, as required by the MT-SICS protocol.

### `src/CustomConnection.js`

*   **Change**: This file was updated to integrate the new `MtsicsClient` and implement the core logic of the connector.
*   **Why**: To use the new MT-SICS compliant client and to implement the data polling and processing features required by the specification.
*   **Details**:
    *   **Client Integration**: The connection now instantiates and uses the new `MtsicsClient`.
    *   **Polling Mechanism**: A polling mechanism was added using the `node-cron` library. It periodically calls a new `_pollScale` method to fetch data from the scale.
    *   **Data Fetching & Parsing**: New private methods (`_pollScale`, `_parseResponse`) were added to send commands (`S`, `TA`, `PCS`), parse the raw ASCII responses, and map the device statuses (e.g., `S` -> `OK`, `D` -> `KO`) as required.
    *   **JSON Formatting**: The `_pollScale` method assembles the parsed data into the final JSON structure specified in the requirements, including a timestamp and the dynamic `mode` (`WEIGHING`/`COUNTING`).
    *   **Method Correction**: The `handleRead` and `handleWrite` methods were updated to correctly use the new client and pass commands and arguments.

### `src/CustomConnection.json`

*   **Change**: A new property, `pollingInterval`, was added to the connection schema.
*   **Why**: To allow the data polling interval to be easily configured from the Connectware UI, making the connector more flexible.

## 3. Agent (Custom Connector)

This section describes how to build, run, and test the M-SICS custom connector agent.

### Building the Agent

The agent is containerized using Docker. To build the Docker image, you can use the `docker-compose.yaml` file provided in the root of the project.

```bash
# This will build the image and tag it as 'mt-sics-custom-connector-agent'
docker compose build
```

### Running the Agent

The agent is designed to be run as a Docker container and connect to a Cybus Connectware instance. The `docker-compose.yaml` file is pre-configured to run the agent.

**1. Configuration**

Before running the agent, ensure the environment variables in `docker-compose.yaml` are set correctly.

```yaml
services:
  agent:
    ...
    environment:
      CYBUS_MQTT_HOST: localhost  # Hostname or IP of Connectware's MQTT broker
      CYBUS_MQTT_PORT: 1883       # Port of Connectware's MQTT broker
      CYBUS_USER: admin           # Username for connecting to Connectware
      CYBUS_PASSWORD: admin       # Password for connecting to Connectware
      CYBUS_AGENT_NAME: MtsicsAgent # Name of the agent in Connectware
      ...
```

**2. Run with Docker Compose**

```bash
# This will start the agent service in detached mode
docker compose up -d
```

**3. Agent Authorization**

On the first run, the agent will generate a new set of credentials and request to be authorized by Connectware. You will need to approve this request in the Connectware web UI.

1.  Check the agent's logs to get the pairing ID:
    ```bash
    docker logs mt-sics-custom-connector-agent-1
    ```
2.  In the Connectware UI, navigate to **User Management -> Client Registry**.
3.  Find the client with the name `MtsicsAgent` and the matching pairing ID, and authorize it.

### Testing the Agent

A comprehensive test suite is included to ensure the connector's functionality. The tests are run against a mock scale server, so no physical hardware is required.

To run the tests, execute the following command from the root of the project:

```bash
npm test
```

This command will:
1.  Start the mock scale server.
2.  Run a series of unit tests that check individual components in isolation.
3.  Run a series of integration tests that check the complete data flow of the connector.
4.  Print a summary of the test results.

## 4. Mock Scale Simulator (Stateful)

For end-to-end testing of the connector without a physical device, a stateful mock scale simulator is provided in the `mock-scale-simulator/` directory.

This simulator is a containerized Node.js application that mimics the behavior of a Mettler Toledo scale by maintaining an internal state (weight, tare, stability, etc.) and generating dynamic responses to MT-SICS commands. It also provides an HTTP API to dynamically control this state.

### How to Use

**1. Build the Docker Image**

Navigate to the `mock-scale-simulator/` directory and run the build command:

```bash
cd mock-scale-simulator
docker build -t mock-scale-simulator .
```

**2. Run the Simulator Container**

Run the simulator in a Docker container, mapping the TCP and HTTP ports to your host machine:

```bash
# Stop and remove any previous instance
docker rm -f scale-simulator

# Run the new container (using port 8081 for HTTP to avoid conflicts)
docker run -d -p 4305:4305 -p 8081:8080 --name scale-simulator mock-scale-simulator
```

*   The mock scale will be accessible on `localhost:4305`.
*   The HTTP control interface will be accessible on `http://localhost:8081`.

**3. Control the Mock Scale's State**

You can control the mock scale's internal state by sending HTTP requests to the control interface.

*   **Set the state of the scale:**

    Use `curl` to send a `POST` request. The body should be a JSON object with the state properties you want to change.

    ```bash
    # Example: Set the gross weight to 150g and make it stable
    curl -X POST -H "Content-Type: application/json" \
      -d '{ "grossWeight": 150, "isStable": true }' \
      http://localhost:8081/state

    # Example: Simulate an overload condition
    curl -X POST -H "Content-Type: application/json" \
      -d '{ "isOverloaded": true }' \
      http://localhost:8081/state
      
    # Example: Change the serial number
    curl -X POST -H "Content-Type: application/json" \
      -d '{ "serialNumber": "B987654321" }' \
      http://localhost:8081/state
    ```
    The simulator will respond with the full updated state.

*   **View the current state:**

    ```bash
    curl http://localhost:8081/state
    ```

### Connecting the Mtsics Agent

Once the mock simulator is running, you can deploy the Mtsics agent and configure its connection in Connectware to point to the simulator's address (`host: localhost` or the IP of your Docker host, `port: 4305`). This allows you to test the full data flow and the connector's logic against a dynamic, simulated scale.


docker logs mt-sics-custom-connector-agent-1