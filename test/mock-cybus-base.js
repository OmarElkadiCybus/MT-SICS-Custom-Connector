// This file sets up module aliasing for the test environment.
// It allows require('Connection') and require('Endpoint') to work in tests
// without modifying the source code.

const path = require('path');
const moduleAlias = require('module-alias');

moduleAlias.addAlias('Connection', path.join(__dirname, 'mocks/Connection.js'));
moduleAlias.addAlias('Endpoint', path.join(__dirname, 'mocks/Endpoint.js'));