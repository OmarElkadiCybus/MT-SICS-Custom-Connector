const Endpoint = require('Endpoint');
const schema = require('./MtsicsEndpoint.json');

class MtsicsEndpoint extends Endpoint {
    static getCustomSchema() {
        return { ...schema };
    }
}

module.exports = MtsicsEndpoint;
