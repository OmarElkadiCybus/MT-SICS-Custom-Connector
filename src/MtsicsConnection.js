const Connection = require('Connection');
const MtsicsClient = require('./Client.js');
const schema = require('./MtsicsConnection.json');
const cron = require('node-cron');

class MtsicsConnection extends Connection {
    constructor(params) {
        super(params);

        this.client = new MtsicsClient({
            host: params.connection.host,
            port: params.connection.port,
            eol: params.connection.eol,
            responseTimeoutMs: params.connection.responseTimeoutMs,
            encoding: params.connection.encoding,
        });

        this.client
            .on('error', err => {
                console.error('MTSICS Client Error:', err.message);
                this.connectLost();
            })
            .on('close', this._onClose.bind(this));

        this.pollingInterval = params.connection.pollingInterval || '*/5 * * * * *';
        this.cronJob = null;
        this.mode = 'WEIGHING';
        this.lastData = {};
    }

    static getCustomSchema() {
        return { ...schema };
    }

    async handleConnect() {
        try {
            await this.client.connect();
            this.connectDone();
            this._startPolling();
        } catch (err) {
            this.connectFailed(err.message);
        }
    }

    async handleReconnect() {
        await this.handleDisconnect();
        await this.handleConnect();
    }

    async handleDisconnect() {
        this._stopPolling();
        this.client.end();
        this.disconnectDone();
    }

    _updateMode(command) {
        if (['PCS', 'PW', 'REF'].includes(command)) {
            this.mode = 'COUNTING';
        }
        if (command === '@') {
            this.mode = 'WEIGHING';
        }
    }

    async handleRead(address, requestData = {}) {
        const command = this._normalizeCommand(address);
        const args = this._normalizeArgs(address, requestData.args);
        const response = await this.client.sendCommand(command, ...args);
        this._updateMode(command);
        return this._parseResponse(command, response);
    }

    async handleWrite(address, writeData) {
        const command = this._normalizeCommand(address);
        const args = this._normalizeArgs(address, writeData);

        const response = await this.client.sendCommand(command, ...args);
        this._updateMode(command);
        return this._parseResponse(command, response);
    }

    _startPolling() {
        this.cronJob = cron.schedule(this.pollingInterval, async () => {
            try {
                const data = await this._pollScale();
                this.lastData = data;
                this.publishData(data);
            } catch (error) {
                console.error('Polling failed:', error.message);
            }
        });
    }

    _stopPolling() {
        if (this.cronJob) {
            this.cronJob.stop();
            this.cronJob = null;
        }
    }

    async _pollScale() {
        const timestamp = Date.now();

        const [sResponse, taResponse, pcsResponse] = await Promise.all([
            this.client.sendCommand('S').catch(() => null),
            this.client.sendCommand('TA').catch(() => null),
            this.client.sendCommand('PCS').catch(() => null),
        ]);

        const parsedS = this._parseResponse('S', sResponse);
        const parsedTa = this._parseResponse('TA', taResponse);
        const parsedPcs = this._parseResponse('PCS', pcsResponse);

        if (parsedPcs.count_quantity !== null) {
            this.mode = 'COUNTING';
        }

        return {
            timestamp,
            mode: this.mode,
            ...parsedS,
            ...parsedTa,
            ...parsedPcs,
        };
    }

    _parseResponse(command, response) {
        if (!response) {
            return this._getEmptyParsedData(command);
        }

        const parts = response.split(/\s+/);
        const status = parts[1];

        switch (command) {
            case 'S':
            case 'SI':
                return {
                    weight_value: parseFloat(parts[2]) || 0,
                    weight_unit: parts[3] || null,
                    weight_status: status === 'S' ? 'OK' : 'KO',
                };
            case 'TA':
                if (parts.length >= 4) {
                    return {
                        tare_value: parseFloat(parts[2]) || 0,
                        tare_unit: parts[3] || null,
                        tare_status: 'OK',
                    };
                }
                return {
                    tare_value: 0,
                    tare_unit: null,
                    tare_status: 'OK',
                };
            case 'PCS':
                return {
                    count_quantity: parseInt(parts[2], 10) || 0,
                    count_status: status === 'S' ? 'OK' : 'KO',
                };
            case '@':
            case 'TAC':
            case 'T':
            case 'Z':
            case 'REF':
                 return {
                    command: command,
                    status: status === 'A' ? 'OK' : 'KO',
                    raw: response,
                };
            default:
                return { raw: response };
        }
    }

    _getEmptyParsedData(command) {
        switch (command) {
            case 'S':
                return { weight_value: null, weight_unit: null, weight_status: 'KO' };
            case 'TA':
                return { tare_value: null, tare_unit: null, tare_status: 'KO' };
            case 'PCS':
                return { count_quantity: null, count_status: 'KO' };
            default:
                return {};
        }
    }

    _onClose() {
        if (this.getState() === 'connected') {
            this.connectLost();
        }
    }

    _normalizeCommand(address) {
        if (typeof address === 'string') {
            return address.trim().toUpperCase();
        }

        if (address && typeof address === 'object') {
            const value = address.command ;
            if (typeof value === 'string') {
                return value.trim().toUpperCase();
            }
        }

        throw new Error('Invalid MT-SICS command address');
    }

    _normalizeArgs(address, data) {
        if (address && typeof address === 'object' && Array.isArray(address.args)) {
            return address.args.map(String);
        }

        if (Array.isArray(data)) {
            return data.map(String);
        }

        if (typeof data === 'string') {
            return data.trim() ? data.trim().split(/\s+/) : [];
        }

        if (data !== undefined && data !== null) {
            return [String(data)];
        }

        return [];
    }
}
module.exports = MtsicsConnection;
