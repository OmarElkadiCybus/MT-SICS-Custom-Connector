const Connection = require('Connection')
const Client = require('./Client.js')
const schema = require('./MtsicsConnection.json');
// const cron = require('node-cron'); // REMOVED

class MtsicsConnection extends Connection {
    constructor(params) {
        super(params)

        this._host = params.connection.host
        this._port = params.connection.port
        const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
        this._log = {
            info: console.info,
            warn: console.warn,
            error: console.error,
            debug: (LOG_LEVEL === 'debug') ? console.log : () => {},
        };

        this._client = new Client({ log: this._log })
        this._client
            .on('error', err => {
                this._log.error('MtsicsConnection client error:', err.message);
                this.connectLost(err.message);
            })
            .on('close', this._onClose.bind(this))
        
        this.mode = 'WEIGHING'; // Default mode
        this._subscriptions = new Map(); // NEW: To store active subscriptions
    }

    // Protocol implementation interface method
    static getCustomSchema() {
        return { ...schema };
    }

    // Protocol implementation interface method
    async handleConnect() {
        await this._createConnection();
        // Polling logic moved to handleSubscribe
    }

    // Protocol implementation interface method
    async handleReconnect() {
        await this._closeConnection()
        await this._createConnection()
    }

    // Protocol implementation interface method
    async handleDisconnect() {
        // Polling logic moved to handleSubscribe
        // Stop all active polling jobs
        for (const [key, { job }] of this._subscriptions.entries()) {
            if (job) {
                clearInterval(job); // Changed from job.stop()
                this._log.info(`Polling job for ${key} stopped.`);
            }
        }
        this._subscriptions.clear(); // Clear subscriptions
        await this._closeConnection()
    }

    // Protocol implementation interface method (called for READ and SUBSCRIBE Endpoints)
    async handleRead(address, requestData = {}) {
        if (address.mode) {
            this.mode = address.mode;
        }
        const rawResponse = await this._client.read(address.command)
        const parsedResponse = this._parseMtsicsResponse(rawResponse);
        const readTimeout = address.timeout || 5000; // Default to 5 seconds if not specified
        this._updateMode(address.command);
         
        return parsedResponse;
    }

    // Protocol implementation interface method (called for WRITE Endpoints)
    async handleWrite(address, writeData) {
        this._log.debug(`[MtsicsConnection] handleWrite: address=${JSON.stringify(address)}, writeData=${writeData}`);
        if (address.mode) {
            this.mode = address.mode;
        }
        const rawResponse = await this._client.write(address.command, writeData);
        const parsedResponse = this._parseMtsicsResponse(rawResponse);
        this._updateMode(address.command);
        return parsedResponse;
    }

    // REMOVED _pollScale method

    /**
     * Handle subscription requests from Connectware.
     * This method will set up a polling mechanism for the subscribed command.
     */
    async handleSubscribe(address, onData) {
        const { command, interval, mode } = address; // Expect command and interval from address
        this._log.info(`[MtsicsConnection] handleSubscribe: ${JSON.stringify(address)}`);

        if (mode) {
            this.mode = mode;
        }

        if (!command) {
            throw new Error('Subscription address must contain a command.');
        }
        if (!interval) {
            throw new Error('Subscription address must contain an interval for polling.');
        }

        // Stop any existing polling job for this command
        if (this._subscriptions.has(command)) {
            const { job } = this._subscriptions.get(command);
            if (job) clearInterval(job); // Changed from job.stop()
            this._subscriptions.delete(command);
        }

        const pollingJob = setInterval(async () => { // Changed from cron.schedule
            if (this.getState() !== 'connected') {
                this._log.warn(`Not connected, skipping poll for ${command}.`);
                return;
            }
            try {
                const rawResponse = await this._client.read(command);
                const parsedResponse = this._parseMtsicsResponse(rawResponse);
                this._updateMode(command);
                onData(parsedResponse); // Emit data back to Connectware
            } catch (err) {
                this._log.error(`Error during polling for ${command}:`, err.message);
                // Optionally emit an error or handle it based on requirements
            }
        }, interval); // Use interval directly
        // pollingJob.start(); // REMOVED
        this._log.info(`Polling started for command ${command} with interval: ${interval}ms`);

        this._subscriptions.set(command, { onData, job: pollingJob });
    }

    /**
     * Handle unsubscription requests from Connectware.
     */
    async handleUnsubscribe(address) {
        const { command } = address;
        this._log.info(`[MtsicsConnection] handleUnsubscribe: ${JSON.stringify(address)}`);

        if (this._subscriptions.has(command)) {
            const { job } = this._subscriptions.get(command);
            if (job) {
                clearInterval(job); // Changed from job.stop()
                this._log.info(`Polling job for ${command} stopped.`);
            }
            this._subscriptions.delete(command);
        }
    }

    _parseMtsicsResponse(response) {
        const parts = response.trim().split(/\s+/);
        const command = parts[0];
        const status = parts[1];

        // Handle single-word error responses
        if (parts.length === 1) {
            if (response === 'ES') throw new Error('MT-SICS: Syntax Error');
            if (response === 'EL') throw new Error('MT-SICS: Logical Error (invalid command)');
            // Potentially other single-word responses
            return { raw: response };
        }

        // Handle generic overload/underload errors
        if (status === '+') throw new Error(`MT-SICS: Overload on command "${command}"`);
        if (status === '-') throw new Error(`MT-SICS: Underload on command "${command}"`);

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
            if (status === 'L') throw new Error('MT-SICS: Logical Error (invalid parameter for D)');
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
            throw new Error(`MT-SICS: Command "${command}" not executable.`);
        }

        // Fallback for unknown formats
        this._log.warn(`Unhandled MT-SICS response format: ${response}`);
        return { raw: response };
    }

    _updateMode(command) {
        if (['PCS', 'PW', 'REF'].includes(command)) {
            this.mode = 'COUNTING';
        } else if (['@', 'Z', 'T', 'TA', 'TAC'].includes(command)) {
            this.mode = 'WEIGHING';
        }
        // Other commands might also affect mode, add as needed
    }

    async _createConnection() {
        try {
            await this._client.connect(this._host, this._port)
        } catch (err) {
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
        if (this.getState() === 'connected') this.connectLost()
    }
}

module.exports = MtsicsConnection

