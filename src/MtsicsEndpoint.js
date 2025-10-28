const Endpoint = require('Endpoint')
const schema = require('./MtsicsEndpoint.json')

class MtsicsEndpoint extends Endpoint {
  static getSchema () {
    return Object.assign(super.getSchema(), schema)
  }

  constructor (options) {
    super(options)
    const { command } = options.address
    this._topic = command
  }

  _getTopic () {
    return this._topic
  }
}

module.exports = MtsicsEndpoint