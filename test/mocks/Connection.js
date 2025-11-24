const { EventEmitter } = require('events');

// This is a mock of the base Connection class provided by the Cybus environment.
class MockConnection extends EventEmitter {
    constructor(params) {
        super();
        this.params = params;
        this.state = 'disconnected';
        this.connectionLostCalled = false;
    }

    getState() {
        return this.state;
    }

    connectFailed(error) {
        this.state = 'connectionFailed';
        this.emit('connectionFailed', error);
    }

    reconnectFailed(error) {
        this.state = 'reconnectionFailed';
        this.emit('reconnectionFailed', error);
    }

    connectDone() {
        this.state = 'connected';
        this.emit('connected');
    }

    disconnectDone() {
        this.state = 'disconnected';
        this.emit('disconnected');
    }

    connectLost(error) {
        if (!this.connectionLostCalled) {
            this.connectionLostCalled = true;
            this.state = 'connectionLost';
            this.emit('connectionLost', error);
        }
    }
}

module.exports = MockConnection;
