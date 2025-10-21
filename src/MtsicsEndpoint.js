'use strict'
const isUsingCybusBaseImage = process.env.CYBUS_IMAGE_BASE
const modulePathPrefix = isUsingCybusBaseImage ? '' : '../../cybus/protocol-mapper/src/'
const Endpoint = require(modulePathPrefix + 'Endpoint')
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