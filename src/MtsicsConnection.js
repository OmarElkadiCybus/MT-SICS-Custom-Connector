const Connection = require('Connection')
const Client = require('./Client.js')
const schema = require('./MtsicsConnection.json');
const { validateWriteCommand, validateReadCommand } = require('./CommandValidator.js');


class MtsicsConnection extends Connection {
    constructor(params) {
        super(params)

        this._host = params.connection.host
        this._port = params.connection.port
        const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
        this._log = {
            info: (...args) => console.info('[INFO]', ...args),
            warn: (...args) => console.warn('[WARN]', ...args),
            error: (...args) => console.error('[ERROR]', ...args),
            debug: (LOG_LEVEL === 'debug') ? (...args) => console.log('[DEBUG]', ...args) : () => {},
            level: LOG_LEVEL,
        };

        this._client = new Client({ log: this._log })
        this._client
            .on('error', err => {
                this._log.error(`[MtsicsConnection] client error: ${err.message}`);
                this.connectLost(err.message);
            })
            .on('close', this._onClose.bind(this))
        
        this.mode = 'WEIGHING'; // Default mode
    }

    // Protocol implementation interface method
    static getCustomSchema() {
        return { ...schema };
    }

    // Protocol implementation interface method
    async handleConnect() {
        this._log.info(`[MtsicsConnection] connecting to ${this._host}:${this._port}`);
        await this._createConnection();
        this._log.info('[MtsicsConnection] connection established');
    }

    // Protocol implementation interface method
    async handleReconnect() {
        this._log.warn('[MtsicsConnection] reconnect requested');
        await this._closeConnection()
        await this._createConnection()
        this._log.info('[MtsicsConnection] reconnected');
    }

    // Protocol implementation interface method
    async handleDisconnect() {
        this._log.info('[MtsicsConnection] disconnect requested');
        await this._closeConnection()
    }

    // Protocol implementation interface method (called for READ and SUBSCRIBE Endpoints)
    async handleRead(address, requestData = {}) {
        this._updateMode(address.command);
        if (address.mode) {
            this.mode = address.mode;
        }
        this._log.debug(`[MtsicsConnection] read command="${address.command}" mode=${this.mode} timeout=${address.timeout || 'default'}`);
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
                this._log.warn(`[MtsicsConnection] Ignoring payload for command without payload support: ${address.command}`);
            }
            writeData = undefined;
        }
        this._updateMode(address.command);
        if (address.mode) {
            this.mode = address.mode;
        }
        this._log.debug(`[MtsicsConnection] write command="${address.command}" payload=${JSON.stringify(writeData)} mode=${this.mode} timeout=${address.timeout || 'default'}`);
        let payload = this._extractPayload(writeData);
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

    _updateMode(command) {
        const nextMode = (['PCS', 'PW', 'REF'].includes(command)) ? 'COUNTING'
                         : (['@', 'Z', 'T', 'TA', 'TAC'].includes(command) ? 'WEIGHING' : this.mode);

        if (nextMode !== this.mode) {
            this._log.info(`[MtsicsConnection] switching mode ${this.mode} -> ${nextMode} due to command ${command}`);
            this.mode = nextMode;
        }
        // Other commands might also affect mode, add as needed
    }

    async _createConnection() {
        try {
            await this._client.connect(this._host, this._port)
        } catch (err) {
            this._log.error(`[MtsicsConnection] connect error: ${err.message}`);
            switch (this.getState()) {
                case 'connecting':
                    this.connectFailed(err.message)
                    break
                case 'reconnecting':
                    this.reconnectFailed(err.message)
                    break
                default:
                   this._log.error(`MtsicsConnection:_createConnection error in state ${this.getState()}: ${err.message}`);
                   this.connectLost(err.message);
            }
            return
        }

        this.connectDone()
    }

    async _closeConnection() {
        this._client.end()

        if (this.getState() === 'disconnecting') {
            this.disconnectDone()
        }
    }

    _onClose() {
        if (this.getState() === 'connected') {
            this._log.warn('[MtsicsConnection] socket closed unexpectedly; marking connection lost');
            this.connectLost()
        }
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

    _extractPayload(writeData) {
        let payload = writeData;
        if (typeof writeData === 'object' && writeData !== null) {
            const hasValueProperty = Object.prototype.hasOwnProperty.call(writeData, 'value');
            const onlyValueProperty = hasValueProperty && Object.keys(writeData).length === 1;
            if (!onlyValueProperty) {
                throw new Error("Invalid writeData object. It must only contain a 'value' property.");
            }
            payload = writeData.value;
        } else if (writeData !== undefined && writeData !== null && typeof writeData !== 'string') {
            this._log.warn(`[Client.js] the payload is not string, its type is ${typeof writeData}, converting to string`);
            payload = String(writeData);
        }
        this._log.debug(`[MtsicsConnection] Extracted payload is: ${payload}`);
        return payload;
    }
}

module.exports = MtsicsConnection
