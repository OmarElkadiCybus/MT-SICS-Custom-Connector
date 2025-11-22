const { EventEmitter } = require('events')
const net = require('net')
const { validateWriteCommand } = require('./CommandValidator.js');

class Client extends EventEmitter {
  constructor(params = {}) {
    super()
    this._log = params.log || console;
    this.conn = new net.Socket()
    this.conn.on('close', (hadError) => this.emit('close', hadError))
    this.conn.on('error', (err) => this.emit('error', err))
    this.conn.on('data', (data) => this._handleData(data))

    this.commandQueue = []
    this.isProcessing = false
    this.responseCallback = null
    this.responseTimeout = null
    this.buffer = ''
  }

  connect(host, port) {
    return new Promise((resolve, reject) => {
      this.conn.once('error', (err) => reject(err))
      this.conn.connect({ host, port }, () => {
        this.conn.off('error', reject)
        resolve()
      })
    })
  }

  end() {
    this.conn.destroy()
  }

  read(address, timeout = 2000) {
    return this._sendCommand(address, timeout)
  }

  write(command, data, timeout = 2000) { 

    validateWriteCommand(command, data, this._log)
      

    let commandToSend = command;
    if (String(data).length > 0) {
        commandToSend = `${command} ${data}`;
    }
    
    this._log.debug(`[Client.js] Sending command: ${commandToSend}`);
    return this._sendCommand(commandToSend, timeout)
  }

  _sendCommand(command, timeout) {
    return new Promise((resolve, reject) => {
      this.commandQueue.push({ command, resolve, reject, timeout })
      this._processQueue()
    })
  }

  _processQueue() {
    this._log.debug(`[Client.js] _processQueue called. isProcessing: ${this.isProcessing}, queue length: ${this.commandQueue.length}`);
    if (this.isProcessing || this.commandQueue.length === 0) {
      return
    }

    this.isProcessing = true
    const { command, resolve, reject, timeout } = this.commandQueue.shift()

    this.responseCallback = (err, response) => {
      if (err) {
        reject(err)
      }
      else {
        resolve(response)
      }
      this.isProcessing = false
      this._processQueue()
    }

    this.responseTimeout = setTimeout(() => {
      if (this.responseCallback) {
        const err = new Error(`Command "${command}" timed out`);
        this.conn.destroy(); // Just destroy, don't pass error
        this.emit('error', err); // Emit error manually
        this.responseCallback(err);
        this.responseCallback = null;
      }
    }, timeout)

    this._log.debug(`[Client.js] Writing to socket: ${command}\r\n`);
    this.conn.write(`${command}\r\n`)
  }

  _handleData(data) {
    this.buffer += data.toString()
    let newlineIndex
    while ((newlineIndex = this.buffer.indexOf('\r\n')) !== -1) {
      const response = this.buffer.substring(0, newlineIndex).trim()
      this.buffer = this.buffer.substring(newlineIndex + 2)

      if (this.responseCallback) {
        const callback = this.responseCallback;
        this.responseCallback = null; // Prevent the same callback from being used for the next item in the buffer

        clearTimeout(this.responseTimeout)
        callback(null, response)
      } else {
        // Handle unsolicited data if necessary
        this.emit('unsolicited-data', response)
      }
    }
  }
}

module.exports = Client
