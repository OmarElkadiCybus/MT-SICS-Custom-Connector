# MT-SICS Custom Connector

Cybus agent for MT-SICS-enabled Mettler Toledo scales. Two detailed guides: Operators and Developers.

## 1) Operators
- What it does: bridges Connectware to MT-SICS scales for weight/tare/pieces, zero/tare, preset tare, piece reference, and display text.
- Start the agent: set MQTT env vars in `docker-compose.yaml` (`CYBUS_MQTT_HOST/PORT/USER/PASSWORD`, `CYBUS_AGENT_NAME`), then `docker compose up -d`.
- Wire the scale: in your service configuration, set MT-SICS host/port on the `Cybus::Connection` and reference it from endpoints. Command snippets and payload rules are in `CUSTOM_CONNECTOR_MANUAL.md`.
- Common endpoints/commands: `S`, `SI`, `T`, `TA`, `Z/ZI`, `TAC`, `PW`, `PCS`, `REF`, `@`, `D`. Payloads must match MT-SICS syntax (e.g., `TA 100 g`, `D "hello"`). `REF` can include a count (`REF 10`) or omit it to use stored reference.
- Simulator: `docker compose -f docker-compose.simulator.yaml up -d` exposes MT-SICS TCP on `localhost:4305` and HTTP control on `http://localhost:8081/state`. POST `{"weight":150,"stable":true}` to set state; `{"mute":true}` to suppress replies (timeout testing); `SIM_SILENT=true` to start muted.
- Quick troubleshooting: `ES/EL` ⇒ check command/payload format (quoted `D`, unit on `TA/PW`, integer on `REF`). Repeated MQTT resubscribe logs ⇒ broker restart/connectivity issue; verify broker and credentials.

## 2) Developers
- Key files: `src/MtsicsConnection.js` (connector + parser), `src/Client.js` (TCP + queue), `src/CommandValidator.js` (command/payload validation), `src/MtsicsConnection.json` (schema).
- Prereqs & tests: Node.js 18+, `npm install`, `npm test` (Mocha with mock Cybus base + mock scale server). Integration/unit suites bind ephemeral ports; run off restricted sandboxes to execute all tests.
- Local stack: simulator (`docker compose -f docker-compose.simulator.yaml up`), agent (`docker compose up`). Control verbosity with `LOG_LEVEL`/`CYBUS_LOG_LEVEL` in `docker-compose.yaml`.
- Extending commands: add patterns/examples in `src/CommandValidator.js`, update `_parseMtsicsResponse` in `src/MtsicsConnection.js`, and adjust simulator behavior in `simulators/mtsim_headless_server.py` if needed. Keep payloads aligned with the MT-SICS manual.
- Payload handling: only `TA`, `PW`, `D`, `REF` accept payloads; others ignore provided data. `D` requires quoted strings; `TA/PW` require value+unit; `REF` accepts optional integer count. Validator throws on bad commands/payloads; connector discards payloads for commands that shouldn’t have them.
- Logs: set `LOG_LEVEL=debug` to trace queueing, timeouts, parsing, mode switches, and validation errors. Simulator HTTP control logs connection resets as warnings only.
- MT-SICS parsing highlights: overload/underload (`+`/`-`) and syntax/logic errors (`ES/EL`) throw; `I4/IA` map to `@` responses; unstable weights map to `status:"unstable"`.
