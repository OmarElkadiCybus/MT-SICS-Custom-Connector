require('./mock-cybus-base'); // Setup module aliases
const chai = require('chai');
const chaiAsPromised = require("chai-as-promised");
const MtsicsConnection = require('../src/MtsicsConnection.js');
const MockScaleServer = require('./mock-scale-server.js');

chai.use(chaiAsPromised);
const { expect } = chai;

describe('MtsicsConnection Integration Tests', () => {
    const mockServer = new MockScaleServer();
    const port = 9002;
    let client;

    before(async () => {
        await mockServer.start(port);
    });

    after(async () => {
        await mockServer.stop();
    });

    beforeEach(() => {
        client = new MtsicsConnection({ connection: { host: 'localhost', port } });
        mockServer.clearResponses();
    });

    afterEach(async () => {
        if (client) {
            await client.handleDisconnect();
        }
    });

    it('should connect to the mock server', async () => {
        await client.handleConnect();
        expect(client.getState()).to.equal('connected');
    });

    it('should handle read command for stable weight', async () => {
        await client.handleConnect();
        mockServer.setResponse('S', 'S S      123.45 g');
        const response = await client.handleRead({ command: 'S' });
        expect(response).to.deep.equal({
            command: 'S',
            status: 'stable',
            value: 123.45,
            unit: 'g',
            raw: 'S S      123.45 g',
        });
    });

    it('should handle read command for unstable weight', async () => {
        await client.handleConnect();
        mockServer.setResponse('SI', 'S D      -10.2 kg');
        const response = await client.handleRead({ command: 'SI' });
        expect(response).to.deep.equal({
            command: 'S',
            status: 'unstable',
            value: -10.2,
            unit: 'kg',
            raw: 'S D      -10.2 kg',
        });
    });

    it('should handle write command with success response', async () => {
        await client.handleConnect();
        mockServer.setResponse('Z', 'Z A');
        const response = await client.handleWrite({ command: 'Z' });
        expect(response).to.deep.equal({
            success: true,
            command: 'Z',
            status: 'OK',
            raw: 'Z A',
        });
    });

    it('should handle syntax error from scale', async () => {
        await client.handleConnect();
        mockServer.setResponse('INVALID', 'ES');
        await expect(client.handleRead({ command: 'INVALID' }))
            .to.be.rejectedWith('MT-SICS: Syntax Error');
    });
    
    it('should handle logical error from scale', async () => {
        await client.handleConnect();
        mockServer.setResponse('C', 'EL');
        await expect(client.handleRead({ command: 'C' }))
            .to.be.rejectedWith('MT-SICS: Logical Error (invalid command)');
    });

    it('should handle "command not executable" error from scale', async () => {
        await client.handleConnect();
        mockServer.setResponse('S', 'S I'); // "I" for not executable
        await expect(client.handleRead({ command: 'S' }))
            .to.be.rejectedWith('MT-SICS: Command "S" not executable.');
    });

    it('should handle connection loss', (done) => {
        client.handleConnect().then(() => {
            client.on('connectionLost', () => {
                expect(client.getState()).to.equal('connectionLost');
                done();
            });

            // Stop the server to trigger a connection loss
            mockServer.stop().then(() => {
                 // restart for other tests
                 mockServer.start(port);
            });
        });
    });
});