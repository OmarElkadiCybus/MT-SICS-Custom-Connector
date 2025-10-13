const { VrpcAdapter } = require('vrpc')
const Connection = require('./MtsicsConnection')
const Endpoint = require('./MtsicsEndpoint')

// very important: since 1.10.2 the schema must be registered to the vrpc adapter
VrpcAdapter.register(Endpoint, { schema: Endpoint.getSchema() })
VrpcAdapter.register(Connection, { schema: Connection.getSchema() })
