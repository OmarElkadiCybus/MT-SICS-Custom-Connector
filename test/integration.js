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
                pollingInterval: '*/1 * * * * *' // Poll every second for tests
            }
        };
        connection = new MtsicsConnection(params);
        mockServer.clearResponses();
    });

    afterEach(() => {
        if (connection) {
            connection.handleDisconnect();
        }
    });

    it('should connect, poll data, and publish it', (done) => {
        mockServer.setResponse('S', 'S S 100.0 g');
        mockServer.setResponse('TA', 'TA A 10.0 g');
        mockServer.setResponse('PCS', 'PCS S 5');

        connection.on('data', (data) => {
            try {
                expect(data.weight_value).to.equal(100.0);
                expect(data.weight_unit).to.equal('g');
                expect(data.weight_status).to.equal('OK');
                expect(data.tare_value).to.equal(10.0);
                expect(data.tare_unit).to.equal('g');
                expect(data.tare_status).to.equal('OK');
                expect(data.count_quantity).to.equal(5);
                expect(data.count_status).to.equal('OK');
                expect(data.mode).to.equal('COUNTING');
                done();
            } catch (error) {
                done(error);
            }
        });

        connection.handleConnect();
    }).timeout(3000);

    it('should handle write commands', async () => {
        await connection.handleConnect();
        mockServer.setResponse('T', 'T A');
        const response = await connection.handleWrite('T');
        expect(response).to.deep.equal({
            command: 'T',
            status: 'OK',
            raw: 'T A',
        });
    });

    it('should handle read commands', async () => {
        await connection.handleConnect();
        mockServer.setResponse('SI', 'SI S 50.0 g');
        const response = await connection.handleRead('SI');
        expect(response).to.deep.equal({
            weight_value: 50.0,
            weight_unit: 'g',
            weight_status: 'OK',
        });
    });
    
    it('should change mode to COUNTING after PCS command', (done) => {
        mockServer.setResponse('S', 'S S 100.0 g');
        mockServer.setResponse('TA', 'TA A 10.0 g');
        mockServer.setResponse('PCS', 'PCS S 5');

        let callCount = 0;
        connection.on('data', (data) => {
            callCount++;
            if (callCount === 1) {
                try {
                    expect(data.mode).to.equal('COUNTING');
                    done();
                } catch (error) {
                    done(error);
                }
            }
        });

        connection.handleConnect();
    }).timeout(3000);
    
    it('should reset mode to WEIGHING after @ command', async () => {
        // First, set mode to COUNTING
        mockServer.setResponse('PCS', 'PCS S 5');
        await connection.handleConnect();
        await connection.handleRead('PCS');
        expect(connection.mode).to.equal('COUNTING');

        // Then, reset with @
        mockServer.setResponse('@', '@ A');
        await connection.handleWrite('@');
        expect(connection.mode).to.equal('WEIGHING');
    });
});
