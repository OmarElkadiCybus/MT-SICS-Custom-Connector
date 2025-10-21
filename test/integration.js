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
            for (const [command] of connection._subscriptions.entries()) {
                await connection.handleUnsubscribe({ command });
            }
            await connection.handleDisconnect();
        }
    });

    it('should connect, subscribe, poll data, and publish it', (done) => {
        mockServer.setResponse('S', 'S S 100.0 g');

        connection.handleConnect().then(async () => {
            await connection.handleSubscribe({ command: 'S', interval: 1000 }, (data) => {
                try {
                    expect(data.command).to.equal('S');
                    expect(data.status).to.equal('stable');
                    expect(data.value).to.equal(100.0);
                    expect(data.unit).to.equal('g');
                    done();
                } catch (error) {
                    done(error);
                }
            });
        }).catch(done);
    }).timeout(3000);

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
        mockServer.setResponse('TA 15.5', 'TA A 15.50 g');
        const response = await connection.handleWrite({ command: 'TA' }, 15.5);
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

    it('should change mode to COUNTING after PCS command via subscription', (done) => {
        mockServer.setResponse('PCS', 'PCS S 5');
        
        connection.handleConnect().then(async () => {
            await connection.handleSubscribe({ command: 'PCS', interval: 1000 }, (data) => {
                try {
                    expect(data.command).to.equal('PCS');
                    expect(data.status).to.equal('stable');
                    expect(data.value).to.equal(5);
                    expect(connection.mode).to.equal('COUNTING');
                    done();
                } catch (error) {
                    done(error);
                }
            });
        }).catch(done);
    }).timeout(3000);
    
    it('should reset mode to WEIGHING after @ command', (done) => {
        mockServer.setResponse('PCS', 'PCS S 5');
        mockServer.setResponse('@', 'IA A "dummy-serial"');

        connection.handleConnect().then(async () => {
            // First, set mode to COUNTING via subscription
            await connection.handleSubscribe({ command: 'PCS', interval: 1000 }, async (data) => {
                try {
                    expect(data.command).to.equal('PCS');
                    expect(connection.mode).to.equal('COUNTING');

                    // Then, reset with @
                    await connection.handleWrite({ command: '@' });
                    expect(connection.mode).to.equal('WEIGHING');
                    done();
                } catch (error) {
                    done(error);
                }
            });
        }).catch(done);
    }).timeout(3000);
});