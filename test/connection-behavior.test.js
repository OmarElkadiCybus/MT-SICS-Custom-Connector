require('./mock-cybus-base'); // Setup module aliases for Connection
const { expect } = require('chai');
const { EventEmitter } = require('events');
const MtsicsConnection = require('../src/MtsicsConnection.js');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (conditionFn, timeout = 500, interval = 5) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (conditionFn()) return true;
        await delay(interval);
    }
    throw new Error('Condition not met within timeout');
};
const silentLog = { info: ()=>{}, warn: ()=>{}, error: ()=>{}, debug: ()=>{} };

class FakeClient extends EventEmitter {
    constructor(shared) {
        super();
        this.shared = shared;
        this.connectCalls = 0;
    }

    connect() {
        this.connectCalls += 1;
        const err = this.shared.failures.shift();
        if (err) {
            return Promise.reject(err);
        }
        return Promise.resolve();
    }

    end() {
        this.emit('close', false);
    }

    emitClose(hadError = false) {
        this.emit('close', hadError);
    }

    emitEnd() {
        // Simulate remote half-close leading to close
        this.emit('end');
        this.emit('close', false);
    }
}

class TestConnection extends MtsicsConnection {
    constructor(params) {
        super(params);
        // _createClient will have initialized _sharedState
        this._scheduledDelays = [];
        this._validationCommand = ''; // disable validation for fake client
        this._heartbeatIntervalMs = 0; // disable heartbeat in unit tests
    }

    _createClient() {
        if (!this._sharedState) {
            this._sharedState = { failures: [], clients: [] };
        }
        const client = new FakeClient(this._sharedState);
        this._sharedState.clients.push(client);
        client
            .on('error', err => this._handleClientError(err))
            .on('close', this._onClose.bind(this));
        return client;
    }

    _scheduleReconnect(reason, delayOverride) {
        const delayToRecord = typeof delayOverride === 'number' ? delayOverride : this._currentDelay;
        this._scheduledDelays.push(delayToRecord);
        return super._scheduleReconnect(reason, delayOverride);
    }

    queueFailures(count, message = 'connect failed', code) {
        if (!this._sharedState) {
            this._sharedState = { failures: [], clients: [] };
        }
        for (let i = 0; i < count; i += 1) {
            const err = new Error(message);
            if (code) err.code = code;
            this._sharedState.failures.push(err);
        }
    }

    clearFailures() {
        if (this._sharedState) {
            this._sharedState.failures.length = 0;
        }
    }

    totalConnectAttempts() {
        if (!this._sharedState) return 0;
        return this._sharedState.clients.reduce((sum, client) => sum + client.connectCalls, 0);
    }

    clientsCreatedCount() {
        if (!this._sharedState) return 0;
        return this._sharedState.clients.length;
    }

    activeClient() {
        return this._client;
    }
}

describe('MtsicsConnection connection strategy and edge cases', function () {
    this.timeout(2000);
    let connection;

    afterEach(async () => {
        if (connection) {
            await connection.handleDisconnect();
        }
        connection = null;
    });

    it('retries with exponential backoff, caps delay, and resets after success', async () => {
        connection = new TestConnection({
            connection: {
                host: 'localhost',
                port: 0,
                connectionStrategy: { initialDelayMs: 5, maxDelayMs: 12, backoffFactor: 2 },
            },
            log: silentLog,
        });

        connection.queueFailures(2, 'dial failed');

        await connection.handleConnect();
        expect(connection._scheduledDelays).to.deep.equal([5]); // initial retry scheduled
        expect(connection._currentDelay).to.equal(10);

        // Manually drive scheduled reconnects to avoid timer flakiness in CI
        clearTimeout(connection._reconnectTimer);
        connection._reconnectTimer = null;
        await connection._attemptReconnect(); // 2nd attempt (fails)

        expect(connection._scheduledDelays).to.deep.equal([5, 10]);
        expect(connection._currentDelay).to.equal(12);

        clearTimeout(connection._reconnectTimer);
        connection._reconnectTimer = null;
        await connection._attemptReconnect(); // 3rd attempt (succeeds)

        await waitFor(() => connection.getState() === 'connected', 500);

        expect(connection._scheduledDelays).to.deep.equal([5, 10]); // backoff multiplied then capped to 12 after scheduling
        expect(connection._currentDelay).to.equal(5); // reset after successful connect
        expect(connection.totalConnectAttempts()).to.equal(3);
    });

    it('does not reconnect after an intentional disconnect', async () => {
        connection = new TestConnection({
            connection: {
                host: 'localhost',
                port: 0,
                connectionStrategy: { initialDelayMs: 5, maxDelayMs: 20, backoffFactor: 2 },
            },
            log: silentLog,
        });

        await connection.handleConnect();
        expect(connection.getState()).to.equal('connected');

        await connection.handleDisconnect();
        await delay(30);

        expect(connection._reconnectTimer).to.equal(null);
        expect(connection.totalConnectAttempts()).to.equal(1);
    });

    it('schedules reconnect on unexpected close', async () => {
        connection = new TestConnection({
            connection: {
                host: 'localhost',
                port: 0,
                connectionStrategy: { initialDelayMs: 5, maxDelayMs: 20, backoffFactor: 2 },
            },
            log: silentLog,
        });

        await connection.handleConnect();
        expect(connection.getState()).to.equal('connected');

        // Simulate remote close without an error
        connection.activeClient().emitClose(false);

        expect(connection.getState()).to.equal('connectionLost');
        expect(connection._reconnectTimer).to.not.equal(null);

        await delay(15); // wait for reconnect attempt
        expect(connection.getState()).to.equal('connected');
        expect(connection._reconnectTimer).to.equal(null);
    });

    it('recovers from remote half-close (end) by reconnecting', async () => {
        connection = new TestConnection({
            connection: {
                host: 'localhost',
                port: 0,
                connectionStrategy: { initialDelayMs: 5, maxDelayMs: 20, backoffFactor: 2 },
            },
            log: silentLog,
        });

        await connection.handleConnect();
        expect(connection.getState()).to.equal('connected');

        connection.activeClient().emitEnd();

        expect(connection.getState()).to.equal('connectionLost');
        expect(connection._reconnectTimer).to.not.equal(null);

        await waitFor(() => connection.getState() === 'connected', 500);
        expect(connection._reconnectTimer).to.equal(null);
    });

    it('clears suppress flag after a successful reconnect so future closes reschedule', async () => {
        connection = new TestConnection({
            connection: {
                host: 'localhost',
                port: 0,
                connectionStrategy: { initialDelayMs: 5, maxDelayMs: 20, backoffFactor: 2 },
            },
            log: silentLog,
        });

        await connection.handleConnect();
        // Trigger an intentional reconnect (suppresses one close)
        await connection.handleReconnect();
        expect(connection.getState()).to.equal('connected');

        // Simulate a new remote close after the successful reconnect
        connection.activeClient().emitClose(false);

        await waitFor(() => connection._reconnectTimer !== null, 200);
        await waitFor(() => connection.getState() === 'connected', 500);
        expect(connection._suppressReconnectOnce).to.equal(false);
    });

    it('tears down and recreates socket after a connect timeout', async () => {
        connection = new TestConnection({
            connection: {
                host: 'localhost',
                port: 0,
                connectionStrategy: { initialDelayMs: 5, maxDelayMs: 20, backoffFactor: 2 },
            },
            log: silentLog,
        });

        connection.queueFailures(1, 'connect timed out', 'ETIMEDOUT');

        await connection.handleConnect();
        await waitFor(() => connection.totalConnectAttempts() >= 2, 1500);
        await waitFor(() => connection.getState() === 'connected', 1500);

        expect(connection.totalConnectAttempts()).to.equal(2);
        expect(connection.clientsCreatedCount()).to.equal(2); // new socket created on retry
        expect(connection._currentDelay).to.equal(5); // reset after success
    });
});
