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
| `pollingInterval` | Default cron-style poll | `*/5 * * * * *` (5s) |

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

### Hint: For Commands require no payload, any given payload will be discarded

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

## 6. Snippet Gallery
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
