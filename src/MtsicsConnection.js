const Connection = require('Connection')
const Client = require('./Client.js')
const schema = require('./MtsicsConnection.json');

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
    }

    // Protocol implementation interface method
    static getCustomSchema() {
        return { ...schema };
    }

    // Protocol implementation interface method
    async handleConnect() {
        await this._createConnection();
    }

    // Protocol implementation interface method
    async handleReconnect() {
        await this._closeConnection()
        await this._createConnection()
    }

    // Protocol implementation interface method
    async handleDisconnect() {
        await this._closeConnection()
    }

    // Protocol implementation interface method (called for READ and SUBSCRIBE Endpoints)
    async handleRead(address, requestData = {}) {
        const rawResponse = await this._client.read(address.command)
        return this._parseMtsicsResponse(rawResponse)
    }

    // Protocol implementation interface method (called for WRITE Endpoints)
    async handleWrite(address, writeData) {
        const rawResponse = await this._client.write(address.command, writeData)
        return this._parseMtsicsResponse(rawResponse)
    }

    _parseMtsicsResponse(response) {
        const parts = response.trim().split(/\s+/);
        const command = parts[0];

        // Handle single-word error responses
        if (parts.length === 1) {
            if (response === 'ES') throw new Error('MT-SICS: Syntax Error');
            if (response === 'EL') throw new Error('MT-SICS: Logical Error (invalid command)');
            // Potentially other single-word responses
            return { raw: response };
        }

        const status = parts[1];

        // Handle command acknowledgements (e.g., "Z A")
        if (status.endsWith('A')) {
            return { success: true, command, status, raw: response };
        }
        
        // Handle command not executable
        if (status.endsWith('I')) {
            throw new Error(`MT-SICS: Command "${command}" not executable.`);
        }

        // Handle weight responses (e.g., "S S 12.34 g")
        // According to docs, value is fixed width, but let's try parsing anyway
        if (parts.length >= 3) {
            const value = parseFloat(parts[2]);
            const unit = parts.slice(3).join(' ');
            
            if (!isNaN(value)) {
                return {
                    command,
                    status: status === 'S' ? 'stable' : 'unstable',
                    value,
                    unit,
                    raw: response,
                };
            }
        }

        // Fallback for unknown formats
        return { raw: response };
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
