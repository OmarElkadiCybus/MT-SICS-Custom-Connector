const { EventEmitter } = require('events');
const net = require('net');
const PromiseStore = require('promise-store-js');

class MtsicsClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      host: options.host ?? 'localhost',
      port: options.port ?? 4305,
      eol: options.eol ?? '\r\n',
      responseTimeoutMs: options.responseTimeoutMs ?? 1500,
      encoding: options.encoding ?? 'ascii',
    };

    this.client = new net.Socket();
    this.store = new PromiseStore({ timeout: this.options.responseTimeoutMs });
    this.inBuffer = '';
    this.commandQueue = [];
    this.isProcessing = false;

    this.client
      .on('connect', () => this.emit('connect'))
      .on('error', (err) => this.emit('error', err))
      .on('close', (hadError) => this.emit('close', hadError))
      .on('data', (data) => {
        try {
          this._handleData(data);
        } catch (err) {
          this.emit('error', err);
        }
      });
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.client.once('connect', resolve);
      this.client.once('error', reject);
      this.client.connect({ host: this.options.host, port: this.options.port });
    });
  }

  end() {
    this.client.destroy();
  }

  async sendCommand(command, ...args) {
    const fullCommand = [command, ...args].filter(Boolean).join(' ');
    return new Promise((resolve, reject) => {
      this.commandQueue.push({ command: fullCommand, resolve, reject });
      this._processQueue();
    });
  }

  _processQueue() {
    if (this.isProcessing || this.commandQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const { command, resolve, reject } = this.commandQueue.shift();

    const promise = this.store.create(command);
    promise.then(resolve).catch(reject);

    this.client.write(`${command}${this.options.eol}`, this.options.encoding, (err) => {
      if (err) {
        this.store.reject(new RegExp(command), err);
        this.isProcessing = false;
        this._processQueue();
      }
    });
  }

  _handleData(data) {
    this.inBuffer += data.toString(this.options.encoding);

    let eolIndex;
    while ((eolIndex = this.inBuffer.indexOf(this.options.eol)) !== -1) {
      const response = this.inBuffer.substring(0, eolIndex).trim();
      this.inBuffer = this.inBuffer.substring(eolIndex + this.options.eol.length);

      if (response) {
        const responseCommand = response.split(' ')[0];
        const commandRegex = new RegExp(`^${responseCommand}`);
        if (this.store.resolve(commandRegex, response) === 0) {
          this.emit('unsolicited-data', response);
        }
      }

      this.isProcessing = false;
      this._processQueue();
    }
  }
}

module.exports = MtsicsClient;
