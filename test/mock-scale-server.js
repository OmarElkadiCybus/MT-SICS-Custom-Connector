const net = require('net');
const { EventEmitter } = require('events');

class MockScaleServer extends EventEmitter {
    constructor() {
        super();
        this.server = net.createServer();
        this.sockets = new Set();
        this.responses = new Map();
        this.defaultResponse = 'ES\r\n'; // Syntax Error
        this.silent = false;

        this.server.on('connection', (socket) => {
            this.sockets.add(socket);
            socket.on('data', (data) => {
                if (this.silent) {
                    return;
                }
                const command = data.toString().trim();
                const response = this.responses.get(command) || this.defaultResponse;
                socket.write(response);
            });
            socket.on('close', () => {
                this.sockets.delete(socket);
            });
            socket.on('error', (err) => {
                this.emit('error', err);
            });
        });
    }

    start(port = 0) {
        return new Promise((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(port, '0.0.0.0', () => {
                this.server.removeListener('error', reject);
                this.port = this.server.address().port;
                resolve(this.port);
            });
        });
    }

    stop() {
        return new Promise((resolve) => {
            this.sockets.forEach(socket => socket.destroy());
            this.server.close(resolve);
        });
    }

    setResponse(command, response) {
        this.responses.set(command, `${response}\r\n`);
    }

    clearResponses() {
        this.responses.clear();
    }

    setSilent(silent) {
        this.silent = silent;
    }
}

module.exports = MockScaleServer;
