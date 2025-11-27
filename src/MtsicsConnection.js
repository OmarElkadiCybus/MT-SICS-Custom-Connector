const Connection = require('Connection')
const Client = require('./Client.js')
const schema = require('./MtsicsConnection.json');
const { validateWriteCommand, validateReadCommand } = require('./CommandValidator.js');


class MtsicsConnection extends Connection {
    constructor(params) {
        super(params)

        this._host = params.connection.host
        this._port = params.connection.port
        this._label = `${this._host}:${this._port}`;
        const strategy = (params.connection && params.connection.connectionStrategy) || {};
        this._connectionStrategy = {
            initialDelayMs: Number.isFinite(Number(strategy.initialDelayMs)) ? Number(strategy.initialDelayMs) : 1000,
            maxDelayMs: Number.isFinite(Number(strategy.maxDelayMs)) ? Number(strategy.maxDelayMs) : 30000,
            backoffFactor: Number.isFinite(Number(strategy.backoffFactor)) ? Number(strategy.backoffFactor) : 2,
        };
        if (this._connectionStrategy.initialDelayMs < 0) this._connectionStrategy.initialDelayMs = 0;
        if (this._connectionStrategy.maxDelayMs < this._connectionStrategy.initialDelayMs) {
            this._connectionStrategy.maxDelayMs = this._connectionStrategy.initialDelayMs;
        }
        if (this._connectionStrategy.backoffFactor < 1) this._connectionStrategy.backoffFactor = 1;
        this._currentDelay = this._connectionStrategy.initialDelayMs;
        this._reconnectTimer = null;
        this._shouldReconnect = true;
        this._suppressReconnectOnce = false;
        this._isReconnecting = false;
        this._dropInProgress = false;
        this._connectAttempts = 0;

        const keepAliveMsEnv = Number(process.env.TCP_KEEPALIVE_MS);
        this._keepAliveMs = Number.isFinite(keepAliveMsEnv) && keepAliveMsEnv >= 0 ? keepAliveMsEnv : 15000;

        const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
        this._log = params.log || {
            info: (...args) => console.info('[INFO]', ...args),
            warn: (...args) => console.warn('[WARN]', ...args),
            error: (...args) => console.error('[ERROR]', ...args),
            debug: (LOG_LEVEL === 'debug') ? (...args) => console.log('[DEBUG]', ...args) : () => {},
            level: LOG_LEVEL,
        };

        this._client = this._createClient()
    }

    // Protocol implementation interface method
    static getCustomSchema() {
        return { ...schema };
    }

    // Protocol implementation interface method
    async handleConnect() {
        this._shouldReconnect = true;
        this._dropInProgress = false;
        this._resetBackoff();
        this._log.info(`[MtsicsConnection] connecting to ${this._label} (initialDelay=${this._connectionStrategy.initialDelayMs}ms maxDelay=${this._connectionStrategy.maxDelayMs}ms factor=${this._connectionStrategy.backoffFactor})`);
        const connected = await this._createConnection();
        if (connected) {
            this._log.info('[MtsicsConnection] connection established');
            return;
        }
        this._backoffAndSchedule('connect failed');
    }

    // Protocol implementation interface method
    async handleReconnect() {
        this._log.warn(`[MtsicsConnection] reconnect requested for ${this._label}`);
        this._shouldReconnect = true;
        this._dropInProgress = false;
        this._resetBackoff();
        await this._closeConnection({ suppressReconnect: true })
        this._client = this._createClient()
        const connected = await this._createConnection()
        if (connected) {
            this._log.info('[MtsicsConnection] reconnected');
            return;
        }
        this._backoffAndSchedule('reconnect failed');
    }

    // Protocol implementation interface method
    async handleDisconnect() {
        this._log.info(`[MtsicsConnection] disconnect requested for ${this._label}`);
        this._shouldReconnect = false;
        this._dropInProgress = false;
        await this._closeConnection({ suppressReconnect: true })
    }

    // Protocol implementation interface method (called for READ and SUBSCRIBE Endpoints)
    async handleRead(address, requestData = {}) {
        this._log.debug(`[MtsicsConnection] read command="${address.command}" timeout=${address.timeout || 'default'}`);
        validateReadCommand(address.command, this._log);
        let rawResponse;
        try {
            rawResponse = await this._client.read(address.command, address.timeout)
        } catch (err) {
            this._log.error(`[MtsicsConnection] read failed command="${address.command}" error=${err.message}`);
            throw err;
        }
        const parsedResponse = this._parseMtsicsResponse(rawResponse);
         
        return parsedResponse;
    }

    // Protocol implementation interface method (called for WRITE Endpoints)
    async handleWrite(address, writeData) {
        const payloadCommands = ["TA", "PW", "D", "REF"];
        if (!payloadCommands.includes(address.command)) {
            if (writeData !== undefined && writeData !== null) {
                this._log.warn(`[MtsicsConnection] Ignoring payload for command ${address.command}, because it does not support/require payloads`);
            }
            writeData = undefined;
        }
        this._log.debug(`[MtsicsConnection] write command="${address.command}" payload=${JSON.stringify(writeData)}`);
        let payload = this._extractPayload(address.command, writeData);
        payload = this._sanitizePayload(address.command, payload);
        validateWriteCommand(address.command, payload, this._log);
        let rawResponse;
        try {
            rawResponse = await this._client.write(address.command, payload, address.timeout);
        } catch (err) {
            throw err;
        }
        this._log.debug(`[MtsicsConnection] Raw response on ${address.command} ${payload?payload:''} is: ${rawResponse}`);
        const parsedResponse = this._parseMtsicsResponse(rawResponse);
        this._log.debug(`[MtsicsConnection] Parsed response on write: ${JSON.stringify(parsedResponse)}`);
        return parsedResponse;
    }


    _parseMtsicsResponse(response) {
        const parts = response.trim().split(/\s+/);
        const command = parts[0];
        const status = parts[1];

        // Handle single-word error responses
        if (parts.length === 1) {
            if (response === 'ES') {
                this._log.warn(`[MtsicsConnection] syntax error response: ${response}`);
                throw new Error('MT-SICS: Syntax Error');
            }
            if (response === 'EL') {
                this._log.warn(`[MtsicsConnection] logical error response: ${response}`);
                throw new Error('MT-SICS: Logical Error (invalid command)');
            }
            // Potentially other single-word responses
            return { raw: response };
        }

        // Handle generic overload/underload errors
        if (status === '+') {
            this._log.warn(`[MtsicsConnection] overload on command ${command}: ${response}`);
            throw new Error(`MT-SICS: Overload on command "${command}"`);
        }
        if (status === '-') {
            this._log.warn(`[MtsicsConnection] underload on command ${command}: ${response}`);
            throw new Error(`MT-SICS: Underload on command "${command}"`);
        }

        // Handle '@' command response (e.g., "I4 A <SerialNumber>")
        if ((command === 'I4' || command === 'IA') && status === 'A' && parts.length >= 2) {
            const serialNumber = parts.slice(2).join(' ').replace(/"/g, '');
            return {
                success: true,
                command: '@',
                status: 'OK',
                serialNumber,
                raw: response,
            };
        }

        // Handle weight responses (e.g., "S S 123.45 g" or "S D 12.34 g")
        if (command === 'S' || command === 'SI') {
            try {
                const value = parseFloat(parts[2]);
                const unit = parts.slice(3).join(' ');

                if (!isNaN(value)) {
                    return {
                        command: 'S',
                        status: status === 'S' ? 'stable' : 'unstable',
                        value,
                        unit,
                        raw: response,
                    };
                }
            } catch (e) {
                this._log.error(`Error parsing S/SI response: ${response}, Error: ${e.message}`);
            }
        }

        // Handle Tare responses (e.g., "TA A 12.3 g")
        if (command === 'TA') {
            let value = 0;
            let unit = '';
            if (parts.length >= 3) { // Ensure parts[2] exists
                value = parseFloat(parts[2]);
                unit = parts.slice(3).join(' ');
            }
            if (isNaN(value)) value = 0; // Default to 0 if parsing fails

            return {
                command: 'TA',
                status: 'OK',
                value,
                unit,
                raw: response,
            };
        }

        // Handle Tare command T
        if (command === 'T') {
            const value = parseFloat(parts[2]);
            const unit = parts.slice(3).join(' ');
            if (!isNaN(value)) {
                return {
                    command: 'T',
                    status: parts[1] === 'S' ? 'stable' : 'unstable',
                    value,
                    unit,
                    raw: response,
                };
            }
        }

        // Handle ZI command
        if (command === 'ZI') {
            return {
                command: 'ZI',
                status: parts[1] === 'S' ? 'stable' : 'dynamic',
                raw: response,
            };
        }

        // Handle PW command
        if (command === 'PW') {
            let value = 0;
            let unit = '';
            if (parts.length >= 3) {
                value = parseFloat(parts[2]);
                unit = parts.slice(3).join(' ');
            }
            if (isNaN(value)) value = 0;

            return {
                command: 'PW',
                status: 'OK',
                value,
                unit,
                raw: response,
            };
        }

        // Handle PCS responses (e.g., "PCS S 10")
        if (command === 'PCS') {
            let value = 0;
            if (parts.length >= 3) { // Ensure parts[2] exists
                value = parseInt(parts[2]);
            }
            if (isNaN(value)) value = 0; // Default to 0 if parsing fails

            return {
                command: 'PCS',
                status: status === 'S' ? 'stable' : 'unstable',
                value,
                raw: response,
            };
        }

        // Handle Display responses (e.g., "D A Hello World")
        if (command === 'D') {
            if (status === 'L') {
                this._log.warn('[MtsicsConnection] logical error for D command response');
                throw new Error('MT-SICS: Logical Error (invalid parameter for D)');
            }
            // If it's an acknowledgement (e.g., "D A"), treat it as a success
            if (status.endsWith('A')) {
                return { success: true, command, status: 'OK', raw: response };
            }
            const text = parts.slice(2).join(' '); // Text starts from parts[2]
            return {
                command: 'D',
                status: 'OK',
                value: text,
                raw: response,
            };
        }

        // Handle command acknowledgements (eg., "Z A")
        if (status.endsWith('A')) {
            return { success: true, command, status: 'OK', raw: response };
        }

        // Handle command not executable (e.g., "S I" for S command, "Z I" for Z command)
        // This 'I' status is distinct from the 'I' used for unstable weight in some older protocols
        // With the simulator now returning 'D' for unstable, 'I' here should strictly mean 'not executable'
        if (status.endsWith('I')) {
            this._log.warn(`[MtsicsConnection] command not executable: ${response}`);
            throw new Error(`MT-SICS: Command "${command}" not executable.`);
        }

        // Fallback for unknown formats
        this._log.warn(`Unhandled MT-SICS response format: ${response}`);
        return { raw: response };
    }

    async _createConnection() {
        if (!this._client) {
            this._client = this._createClient()
        }
        const connectTimeout = Number(process.env.CONNECT_TIMEOUT_MS) || 3000;
        const attempt = ++this._connectAttempts;
        const state = this.getState && this.getState();
        this._log.info(`[MtsicsConnection] opening socket to ${this._label} (attempt=${attempt}, state=${state}, timeout=${connectTimeout}ms)`);
        try {
            await this._client.connect(this._host, this._port, connectTimeout)
        } catch (err) {
            const hint = this._formatConnectError(err);
            this._log.error(`[MtsicsConnection] connect error on ${this._label} (attempt=${attempt}): ${err.message}${hint ? ` - ${hint}` : ''}`);
            this._handleConnectionError(err);
            return false;
        }

        this._log.info(`[MtsicsConnection] connected to ${this._label} (attempt=${attempt})`);
        this.connectDone()
        return true;
    }

    _formatConnectError(err) {
        switch (err && err.code) {
            case 'ECONNREFUSED':
                return 'scale refused TCP; device offline/booting or port incorrect';
            case 'ETIMEDOUT':
                return 'connect timed out; check network/firewall or device power';
            case 'EHOSTUNREACH':
            case 'ENETUNREACH':
                return 'host unreachable on network; verify routing/VLAN';
            case 'ENOTFOUND':
            case 'EAI_AGAIN':
                return 'DNS lookup failed; verify hostname';
            default:
                return '';
        }
    }

    _handleConnectionError(err) {
        const state = this.getState && this.getState();
        switch (state) {
            case 'connecting':
                this.connectFailed(err.message);
                break;
            case 'reconnecting':
                this.reconnectFailed(err.message);
                break;
            default:
                this._log.error(`MtsicsConnection:_createConnection error on ${this._label} in state ${state}: ${err.message}`);
                this.connectLost(err.message);
        }
    }

    async _closeConnection(options = {}) {
        const { suppressReconnect = false } = options;
        if (suppressReconnect) {
            this._suppressReconnectOnce = true;
        }
        this._clearReconnectTimer();
        if (this._client) {
            this._client.end()
        }

        if (this.getState() === 'disconnecting') {
            this.disconnectDone()
        }
    }

    _onClose(hadError) {
        const state = this.getState && this.getState();
        const suppressed = this._suppressReconnectOnce;
        this._suppressReconnectOnce = false;

        if (suppressed) {
            this._log.debug(`[MtsicsConnection] socket closed intentionally for ${this._label}; reconnect suppressed`);
            this._dropInProgress = false;
            return;
        }

        if (!this._shouldReconnect || state === 'disconnecting' || state === 'disconnected') {
            this._log.info(`[MtsicsConnection] socket closed on ${this._label} (${state}); reconnect disabled`);
            this._dropInProgress = false;
            return;
        }

        if (this._dropInProgress) {
            this._log.debug('[MtsicsConnection] socket close already handled; skipping duplicate reconnect scheduling');
            return;
        }

        const reason = hadError ? 'socket closed due to error' : 'socket closed';
        this._log.warn(`[MtsicsConnection] ${reason} on ${this._label}; marking connection lost (state=${state})`);
        this._dropInProgress = true;
        if (this.connectLost) {
            this.connectLost(reason);
        }
        this._backoffAndSchedule(reason);
    }

    _sanitizePayload(command, payload) {
        if (payload === undefined || payload === null) {
            return payload;
        }

        let text = String(payload).trim();

        // Strip surrounding quotes
        if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
            text = text.slice(1, -1).trim();
        }

        // If payload already prepends the command, drop it
        const cmdPrefix = new RegExp(`^${command}\\s+`, 'i');
        text = text.replace(cmdPrefix, '').trim();

        if (command === 'D') {
            return `"${text}"`;
        }

        if (command === 'TA' || command === 'PW') {
            text = text.replace(/\s+/g, ' ');
        }

        this._log.debug(`[MtsicsConnection] sanitized payload for ${command}: ${text}`);
        return text;
    }

    _extractPayload(command, writeData) {
        let payload = writeData;
        if (typeof writeData === 'object' && writeData !== null) {
            const hasValueProperty = Object.prototype.hasOwnProperty.call(writeData, 'value');
            const onlyValueProperty = hasValueProperty && Object.keys(writeData).length === 1;
            if (!onlyValueProperty) {
                throw new Error("Invalid writeData object. It must only contain a 'value' property.");
            }
            payload = writeData.value;
        } else if (writeData !== undefined && writeData !== null && typeof writeData !== 'string') {
            payload = String(writeData);
        }
        this._log.debug(`[MtsicsConnection] Extracted payload for the command ${command} is: ${payload}`);
        return payload;
    }

    _createClient() {
        const client = new Client({ log: this._log, keepAliveMs: this._keepAliveMs, label: this._label })
        client
            .on('error', err => {
                this._handleClientError(err);
            })
            .on('close', this._onClose.bind(this))
        return client;
    }

    _handleClientError(err) {
        if (this._suppressReconnectOnce) {
            this._log.debug(`[MtsicsConnection] client error during planned shutdown on ${this._label}: ${err.message}`);
            return;
        }
        if (!this._shouldReconnect) {
            this._log.warn(`[MtsicsConnection] client error with reconnect disabled on ${this._label}: ${err.message}`);
            return;
        }
        if (this._dropInProgress) {
            this._log.debug(`[MtsicsConnection] client error already handled on ${this._label}: ${err.message}`);
            return;
        }
        this._dropInProgress = true;
        this._log.error(`[MtsicsConnection] client error on ${this._label}: ${err.message}`);
        if (this.connectLost) {
            this.connectLost(err.message);
        }
        this._backoffAndSchedule(err.message);
    }

    _scheduleReconnect(reason, delayOverride) {
        if (this._reconnectTimer) {
            this._log.debug(`[MtsicsConnection] reconnect already scheduled for ${this._label}; skipping`);
            return false;
        }
        if (!this._shouldReconnect) {
            this._log.debug(`[MtsicsConnection] reconnect disabled for ${this._label}; not scheduling`);
            return false;
        }
        const state = this.getState && this.getState();
        if (state === 'disconnecting' || state === 'disconnected') {
            this._log.debug(`[MtsicsConnection] not scheduling reconnect for ${this._label} while ${state}`);
            return false;
        }
        const delay = typeof delayOverride === 'number' ? delayOverride : this._currentDelay;
        this._log.warn(`[MtsicsConnection] scheduling reconnect to ${this._label} in ${delay}ms${reason ? ` (${reason})` : ''}`);
        this._reconnectTimer = setTimeout(async () => {
            this._reconnectTimer = null;
            await this._attemptReconnect();
        }, delay);
        return true;
    }

    async _attemptReconnect() {
        const state = this.getState && this.getState();
        if (!this._shouldReconnect) {
            this._log.debug('[MtsicsConnection] reconnect skipped (disabled)');
            return;
        }
        if (state === 'disconnected' || state === 'disconnecting') {
            this._log.debug(`[MtsicsConnection] reconnect skipped in state ${state}`);
            return;
        }
        if (this._isReconnecting) {
            this._log.debug('[MtsicsConnection] reconnect already in progress');
            return;
        }

        this._isReconnecting = true;
        this._dropInProgress = false;

        try {
            this._log.info(`[MtsicsConnection] reconnecting to ${this._label}`);
            await this._closeConnection({ suppressReconnect: true });
            this._client = this._createClient();
            const connected = await this._createConnection();
            if (connected && this.getState && this.getState() === 'connected') {
                this._resetBackoff();
            } else {
                this._backoffAndSchedule('reconnect attempt failed');
            }
        } finally {
            this._isReconnecting = false;
        }
    }

    _resetBackoff() {
        this._clearReconnectTimer();
        this._currentDelay = this._connectionStrategy.initialDelayMs;
        this._dropInProgress = false;
        this._connectAttempts = 0;
    }

    _backoffAndSchedule(reason) {
        const scheduled = this._scheduleReconnect(reason, this._currentDelay);
        if (scheduled) {
            this._increaseBackoff();
            this._log.debug(`[MtsicsConnection] next reconnect backoff for ${this._label} set to ${this._currentDelay}ms`);
        }
    }

    _increaseBackoff() {
        const nextDelay = this._currentDelay * this._connectionStrategy.backoffFactor;
        this._currentDelay = Math.min(this._connectionStrategy.maxDelayMs, Math.max(this._connectionStrategy.initialDelayMs, Math.floor(nextDelay)));
    }

    _clearReconnectTimer() {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }
}

module.exports = MtsicsConnection
