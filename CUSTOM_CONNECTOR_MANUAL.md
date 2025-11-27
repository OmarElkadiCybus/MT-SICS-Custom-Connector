# MT-SICS Custom Connector — Quick Manual

Use this guide to configure the MT-SICS connector in Cybus Connectware and create endpoints for reading, writing, or subscribing to scale data.

## 1. Quick Start
1) Define a `Cybus::Connection` to the scale.  
2) Add `Cybus::Endpoint` resources for reads, writes, or subscriptions.  
3) Send to `/get` (read) or `/set` (write), or let subscriptions poll automatically.

## 2. Connection
Minimal connection resource:
```yaml
resources:
  scaleConnection:
    type: Cybus::Connection
    properties:
      protocol: Mtsics
      agentName: MtsicsAgent
      connection:
        host: "192.168.1.10"
        port: 4305
```
Key fields from `MtsicsConnection.json`:

| Field | Purpose | Default |
| --- | --- | --- |
| `host` (required) | Scale IP/DNS | — |
| `port` | TCP port | `4305` |
| `eol` | Line ending per command | `\r\n` |
| `encoding` | Payload charset | `ascii` |
| `connectionStrategy` | Reconnect backoff (`initialDelayMs`, `maxDelayMs`, `backoffFactor`) | `{1000, 30000, 2}` |
| `connectTimeoutMs` | Handshake timeout before retry | `3000` |
| `connectValidationCommand` | MT-SICS probe sent right after TCP connect (set to `none` to disable) | `S` |
| `connectValidationTimeoutMs` | Timeout for the validation probe | `3000` |
| `tcpKeepaliveMs` | TCP keepalive interval to surface half-open sockets | `15000` |

Reconnect behavior: if the scale is unreachable or mid-boot, the connector fails the TCP handshake after `connectTimeoutMs`, rebuilds the socket, and retries using the `connectionStrategy` backoff. After a successful TCP handshake, it immediately sends `connectValidationCommand` (default `S`) to confirm the scale is responsive; if that times out or fails, the socket is closed and retried. Keepalive (`tcpKeepaliveMs`) helps surface half-open sockets so retries can resume.

Practical tuning:
- `connectionStrategy.initialDelayMs`: first retry delay; set higher if the scale needs a long boot.
- `connectionStrategy.maxDelayMs`: cap for exponential backoff; keep it below your operational SLA.
- `connectTimeoutMs`: shorter helps fail fast when unplugged; longer helps during device boot.
- `connectValidationCommand`/`connectValidationTimeoutMs`: leave the defaults if `S` is safe; set to `none` to disable validation if your device refuses early probes.
- `tcpKeepaliveMs`: leave at default; lower it only if you see stalled connections with no data/FINs. 

## 3. Endpoints
Common fields:

| Field | What it does | Default |
| --- | --- | --- |
| `command` (required) | MT-SICS command to send | — |
| `timeout` | Response timeout (ms) | `5000` |

Endpoint shapes:
- `read`: one-off fetch; trigger by sending anything to `/get`.
- `write`: send command/payload; trigger via `/set`.
- `subscribe`: periodic fetch; uses `connection.pollingInterval` or endpoint `interval`.

## 4. Commands
Use these in `read/subscribe` or `write` blocks.

| Command | Use | Payload (Write only) | Notes |
| --- | --- | --- | --- |
| `S` | Read | — | Stable weight |
| `SI` | Read | — | Immediate weight |
| `TA` | Read/Write | `<number> <unit>` or `{"value":"<number> <unit>"}` | Read tare or set preset tare |
| `PCS` | Read | — | Piece count (COUNTING) |
| `PW` | Read/Write | `<number> <unit>` or `{"value":"<number> <unit>"}` | Piece weight |
| `REF` | Write | (optional) `<number>`  or `{"value":"<number>"}` | Build reference using that piece count; if omitted, uses stored reference |
| `Z` / `ZI` | Write | — | Zero scale (immediate with `ZI`) |
| `T` | Write | — | Tare current load |
| `TAC` | Write | — | Clear tare |
| `D` | Write | `string` or `{"value":"string"}` | Show text on display (write-only) |
| `@` | Read/Write | — | Serial + reset |

### Hint: For commands that require no payload, any given payload will be discarded

## 5. Response Shapes (all include `raw`)
```json
// Weight (S/SI)
{"command":"S","status":"stable","value":123.45,"unit":"g","raw":"S S 123.45 g"}
// Tare (TA/T)
{"command":"TA","status":"OK","value":12.3,"unit":"g","raw":"TA A 12.3 g"}
// Piece count (PCS)
{"command":"PCS","status":"stable","value":10,"raw":"PCS S 10"}
// Piece weight (PW)
{"command":"PW","status":"OK","value":2.5,"unit":"g","raw":"PW A 2.5 g"}
// Serial/reset (@/I4/IA)
{"success":true,"command":"@","status":"OK","serialNumber":"123456789","raw":"I4 A \"123456789\""}
// Acknowledgement (Z/TAC/D/...)
{"success":true,"command":"Z","status":"OK","raw":"Z A"}
```

## 6. Environment Variables
| Variable | Purpose | Default |
| --- | --- | --- |
| `LOG_LEVEL` | Connector log verbosity (`debug`, `info`, `warn`, `error`) | `info` |
| `CONNECT_TIMEOUT_MS` | Max time to complete the TCP handshake before retrying | `3000` |
| `TCP_KEEPALIVE_MS` | TCP keepalive interval to surface half-open sockets (set `0` to disable) | `15000` |
| `CYBUS_MQTT_HOST` / `CYBUS_MQTT_PORT` | MQTT broker address/port for the agent | `localhost` / `1883` |
| `CYBUS_AGENT_NAME` | Agent identifier used by Connectware | `MtsicsAgent` |
| `CYBUS_LOG_LEVEL` | Connectware agent logging (separate from connector logs) | `debug` |

Tip: shorten `CONNECT_TIMEOUT_MS` if the scale drops off the network quickly; increase it if the device needs longer to accept TCP connections after power-up. Leave `TCP_KEEPALIVE_MS` at the default unless you need faster teardown of half-open sockets so the backoff strategy can reconnect.

## 7. Snippet Gallery
Read stable weight:
```yaml
readStableWeight:
  type: Cybus::Endpoint
  properties:
    protocol: Mtsics
    connection: !ref scaleConnection
    read:
      command: 'S'
```
Zero the scale: (does not need a payload; any given payload will be discarded)
```yaml
zeroScale:
  type: Cybus::Endpoint
  properties:
    protocol: Mtsics
    connection: !ref scaleConnection
    write:
      command: 'Z'
```
Set preset tare (expects payload like {"value": "110 g"}):
```yaml
setPresetTare:
  type: Cybus::Endpoint
  properties:
    protocol: Mtsics
    connection: !ref scaleConnection
    write:
      command: 'TA'
```
Subscribe to immediate weight every 2s:
```yaml
subscribeImmediateWeight:
  type: Cybus::Endpoint
  properties:
    protocol: Mtsics
    connection: !ref scaleConnection
    subscribe:
      command: 'SI'
      interval: 2000
```

## 8. Operational Tips
- MQTT topics: `/get` triggers reads, `/set` triggers writes; payload must follow the command’s format rules above.
- Timeouts: each endpoint can override `timeout`; if the scale is silent, the connector drops and reconnects using backoff.
- Logging: set `LOG_LEVEL=debug` when troubleshooting (queueing, reconnect attempts, payload sanitization).
- Many endpoints: the agent raises its listener cap; no action needed for >10 endpoints on one connection.
- Simulator: `docker compose -f docker-compose.simulator.yaml up -d`; POST `{"weight":150,"stable":true}` to `http://localhost:8081/state` to drive responses or `{"mute":true}` to test timeouts.
