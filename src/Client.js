const { EventEmitter } = require('events')
const net = require('net')

class Client extends EventEmitter {
  constructor(params = {}) {
    super()
    this._log = params.log || console;
    this._setupSocket()
    this.commandQueue = []
    this.isProcessing = false
    this.responseCallback = null
    this.responseTimeout = null
    this.buffer = ''
  }

  connect(host, port, timeout = 3000) {
    if (!this.conn || this.conn.destroyed) {
      this._setupSocket()
    }
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        this.conn.off('error', onError);
        this.conn.off('connect', onConnect);
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };
      const onError = (err) => {
        cleanup();
        reject(err);
      };
      const onConnect = () => {
        cleanup();
        this._log.info(`[Client] connected to ${host}:${port}`)
        resolve()
      };
      timer = setTimeout(() => {
        const err = new Error(`Connect timeout to ${host}:${port} after ${timeout}ms`);
        cleanup();
        this.conn.destroy();
        reject(err);
      }, timeout);
      this.conn.once('error', onError)
      this.conn.once('connect', onConnect)
      this.conn.connect({ host, port })
    })
  }

  end() {
    this._log.info('[Client] closing socket')
    this._clearResponseTimer()
    this.responseCallback = null
    this.isProcessing = false
    this.commandQueue = []
    this.buffer = ''
    this.conn.destroy()
  }

  read(address, timeout = 2000) {
    this._log.debug(`[Client] queueing read: ${address}`);
    return this._sendCommand(address, timeout)
  }

  write(command, data, timeout = 2000) { 
      
    let commandToSend = command;
    const hasPayload = data !== undefined && data !== null && String(data).length > 0;
    if (hasPayload) {
        commandToSend = `${command} ${data}`;
    }
    
    this._log.debug(`[Client] queueing write: ${commandToSend}`);
    return this._sendCommand(commandToSend, timeout)
  }

  _sendCommand(command, timeout) {
    return new Promise((resolve, reject) => {
      this.commandQueue.push({ command, resolve, reject, timeout })
      this._log.debug(`[Client] enqueue command="${command}" timeout=${timeout} queueLen=${this.commandQueue.length}`);
      this._processQueue()
    })
  }

  _processQueue() {
    this._log.debug(`[Client] _processQueue isProcessing=${this.isProcessing} queueLen=${this.commandQueue.length}`);
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
        this._log.warn(`[Client] timeout: ${err.message} after ${timeout}ms; closing socket, pending=${this.commandQueue.length}`);
        this.conn.destroy(); // Just destroy, don't pass error
        this.emit('error', err); // Emit error manually
        this.responseCallback(err);
        this.responseCallback = null;
        this.isProcessing = false;
        this._processQueue();
      }
    }, timeout)

    this._log.debug(`[Client] sending "${command}" (timeout ${timeout}ms)`)
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

        this._clearResponseTimer()
        this._log.debug(`[Client] received response: ${response}`)
        callback(null, response)
      } else {
        // Handle unsolicited data if necessary
        this._log.warn(`[Client] unsolicited response (no pending command): ${response}`)
        this.emit('unsolicited-data', response)
      }
    }
  }

  _setupSocket() {
    if (this.conn) {
      this.conn.removeAllListeners()
      this.conn.destroy()
    }
    this.conn = new net.Socket()
    this.conn.on('close', (hadError) => {
      const pending = this.responseCallback;
      if (pending) {
        this.responseCallback = null;
        this._clearResponseTimer();
        pending(new Error('Socket closed before response'));
      }
      this._clearResponseTimer()
      this.isProcessing = false
      this.commandQueue = []
      this.buffer = ''
      this._log.info(`[Client] socket closed${hadError ? ' due to error' : ''}`)
      this.emit('close', hadError)
    })
    this.conn.on('error', (err) => {
      this._log.error(`[Client] socket error: ${err.message}`)
      this.emit('error', err)
    })
    this.conn.on('data', (data) => this._handleData(data))
  }

  _clearResponseTimer() {
    if (this.responseTimeout) {
      clearTimeout(this.responseTimeout)
      this.responseTimeout = null
    }
  }
}

module.exports = Client
