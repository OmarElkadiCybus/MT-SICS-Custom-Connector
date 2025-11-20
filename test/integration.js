const chai = require('chai');
const chaiAsPromised = require("chai-as-promised");
const MtsicsConnection = require('../src/MtsicsConnection.js');
const MockScaleServer = require('./mock-scale-server.js');

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Integration Tests', () => {
    const mockServer = new MockScaleServer();
    const port = 9002;
    let connection;

    before(async () => {
        await mockServer.start(port);
    });

    after(async () => {
        await mockServer.stop();
    });

    beforeEach(() => {
        const params = {
            connection: {
                host: 'localhost',
                port,
            },
            log: console
        };
        connection = new MtsicsConnection(params);
        mockServer.clearResponses();
    });

    afterEach(async () => {
        if (connection) {
            await connection.handleDisconnect();
        }
    });

    it('should handle write commands', async () => {
        await connection.handleConnect();
        mockServer.setResponse('T', 'T A');
        const response = await connection.handleWrite({ command: 'T' });
        expect(response).to.deep.equal({
            success: true,
            command: 'T',
            status: 'OK',
            raw: 'T A',
        });
    });

    it('should handle read commands', async () => {
        await connection.handleConnect();
        mockServer.setResponse('SI', 'S D 50.0 g');
        const response = await connection.handleRead({ command: 'SI' });
        expect(response).to.deep.equal({
            command: 'S',
            status: 'unstable',
            value: 50.0,
            unit: 'g',
            raw: 'S D 50.0 g',
        });
    });
    
    it('should handle write command with tare value', async () => {
        await connection.handleConnect();
        mockServer.setResponse('TA 15.5 g', 'TA A 15.50 g');
        const response = await connection.handleWrite({ command: 'TA' }, '15.5 g');
        expect(response).to.deep.equal({
            command: 'TA',
            status: 'OK',
            value: 15.5,
            unit: 'g',
            raw: 'TA A 15.50 g',
        });
    });

    it('should handle write command with display text', async () => {
        await connection.handleConnect();
        mockServer.setResponse('D "Hello World"', 'D A');
        const response = await connection.handleWrite({ command: 'D' }, "Hello World");
        expect(response).to.deep.equal({
            success: true,
            command: 'D',
            status: 'OK',
            raw: 'D A',
        });
    });
});