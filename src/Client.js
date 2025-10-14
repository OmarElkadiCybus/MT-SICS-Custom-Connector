const { EventEmitter } = require('events')
const net = require('net')

const RESPONSE_TIMEOUT_MS = 2000

class Client extends EventEmitter {
  constructor() {
    super()
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

  read(address) {
    return this._sendCommand(address)
  }

  write(address, data) {
    // MT-SICS commands are uppercase.
    const command = String(address || '').toUpperCase()
    let commandToSend = command

    // Some write commands might include data.
    // The MT-SICS documentation specifies how parameters are passed.
    // For example, TA <value> or D "text".
    // We will assume for now that data is either a single value or quoted string.
    if (data !== undefined && data !== null) {
      if (typeof data === 'string' && data.includes(' ')) {
        commandToSend = `${command} "${data}"`
      } else {
        commandToSend = `${command} ${data}`
      }
    }
    return this._sendCommand(commandToSend)
  }

  _sendCommand(command) {
    return new Promise((resolve, reject) => {
      this.commandQueue.push({ command, resolve, reject })
      this._processQueue()
    })
  }

  _processQueue() {
    if (this.isProcessing || this.commandQueue.length === 0) {
      return
    }

    this.isProcessing = true
    const { command, resolve, reject } = this.commandQueue.shift()

    this.responseCallback = (err, response) => {
      if (err) {
        reject(err)
      } else {
        resolve(response)
      }
      this.isProcessing = false
      this._processQueue()
    }

    this.responseTimeout = setTimeout(() => {
      if (this.responseCallback) {
        const err = new Error(`Command "${command}" timed out`)
        this.responseCallback(err)
        this.responseCallback = null
      }
    }, RESPONSE_TIMEOUT_MS)

    this.conn.write(`${command}\r\n`)
  }

  _handleData(data) {
    this.buffer += data.toString()
    let newlineIndex
    while ((newlineIndex = this.buffer.indexOf('\r\n')) !== -1) {
      const response = this.buffer.substring(0, newlineIndex).trim()
      this.buffer = this.buffer.substring(newlineIndex + 2)

      if (this.responseCallback) {
        clearTimeout(this.responseTimeout)
        this.responseCallback(null, response)
        this.responseCallback = null
      } else {
        // Handle unsolicited data if necessary
        this.emit('unsolicited-data', response)
      }
    }
  }
}

module.exports = Client
