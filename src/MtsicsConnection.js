const Connection = require('Connection')
const Client = require('./Client.js')
const schema = require('./MtsicsConnection.json');
// const cron = require('node-cron'); // REMOVED

class MtsicsConnection extends Connection {
    constructor(params) {
        super(params)

        this._host = params.connection.host
        this._port = params.connection.port

        this._client = new Client()
        this._client
            .on('error', err => {
                console.log('MtsicsConnection client error:', err.message);
                this.connectLost(err.message);
            })
            .on('close', this._onClose.bind(this))
        
        this.mode = 'WEIGHING'; // Default mode
        this._subscriptions = new Map(); // NEW: To store active subscriptions
        this._log = params.log || console; // NEW: Initialize logger
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
                console.log(`Polling job for ${key} stopped.`);
            }
        }
        this._subscriptions.clear(); // Clear subscriptions
        await this._closeConnection()
    }

    // Protocol implementation interface method (called for READ and SUBSCRIBE Endpoints)
    async handleRead(address, requestData = {}) {
        const rawResponse = await this._client.read(address.command)
        const parsedResponse = this._parseMtsicsResponse(rawResponse);
        this._updateMode(address.command);
        return parsedResponse;
    }

    // Protocol implementation interface method (called for WRITE Endpoints)
    async handleWrite(address, writeData) {
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
        const { command, interval } = address; // Expect command and interval from address
        this._log.info(`[MtsicsConnection] handleSubscribe: ${JSON.stringify(address)}`);

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
                console.log(`Not connected, skipping poll for ${command}.`);
                return;
            }
            try {
                const rawResponse = await this._client.read(command);
                const parsedResponse = this._parseMtsicsResponse(rawResponse);
                this._updateMode(command);
                onData(parsedResponse); // Emit data back to Connectware
            } catch (err) {
                console.error(`Error during polling for ${command}:`, err.message);
                // Optionally emit an error or handle it based on requirements
            }
        }, interval); // Use interval directly
        // pollingJob.start(); // REMOVED
        console.log(`Polling started for command ${command} with interval: ${interval}ms`);

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
                console.log(`Polling job for ${command} stopped.`);
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

        // Handle '@' command response (e.g., "I4 A <SerialNumber>")
        if (command === 'I4' && status === 'A' && parts.length >= 3) {
            const serialNumber = parts.slice(2).join(' ');
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
                console.error(`Error parsing S/SI response: ${response}, Error: ${e.message}`);
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

        // Handle PCS responses (e.g., "PCS S 10")
        if (command === 'PCS') {
            let value = 0;
            if (parts.length >= 3) { // Ensure parts[2] exists
                value = parseInt(parts[2]);
            }
            if (isNaN(value)) value = 0; // Default to 0 if parsing fails

            return {
                command: 'PCS',
                status: 'OK',
                value,
                raw: response,
            };
        }

        // Handle Display responses (e.g., "D A Hello World")
        if (command === 'D') {
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

        // Handle command acknowledgements (e.g., "Z A")
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
        return { raw: response };
    }

    _updateMode(command) {
        if (command === 'PCS') {
            this.mode = 'COUNTING';
        }
        else if (command === '@' || command === 'Z') {
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
                   console.log(`MtsicsConnection:_createConnection error in state ${this.getState()}: ${err.message}`);
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

