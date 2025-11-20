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

    start(port) {
        return new Promise((resolve) => {
            this.server.listen(port, 'localhost', resolve);
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
