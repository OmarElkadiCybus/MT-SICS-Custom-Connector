require('./mock-cybus-base'); // Setup module aliases
const chai = require('chai');
const chaiAsPromised = require("chai-as-promised");
const MtsicsConnection = require('../src/MtsicsConnection.js');
const MockScaleServer = require('./mock-scale-server.js');

chai.use(chaiAsPromised);
const { expect } = chai;

describe('MtsicsConnection Unit Tests', () => {
    const mockServer = new MockScaleServer();
    let port;
    let client;

    before(async function () {
        try {
            port = await mockServer.start(0);
        } catch (err) {
            if (err.code === 'EPERM') {
                this.skip();
            }
            throw err;
        }
    });

    after(async () => {
        await mockServer.stop();
    });

    beforeEach(() => {
        const log = { info: ()=>{}, warn: ()=>{}, error: ()=>{}, debug: ()=>{} };
        client = new MtsicsConnection({ connection: { host: 'localhost', port }, log });
        mockServer.clearResponses();
    });

    afterEach(async () => {
        if (client) {
            await client.handleDisconnect();
        }
        mockServer.setSilent(false);
    });

    const expectTimeoutToDropConnection = async (operation, expectedMessage) => {
        await expect(operation()).to.be.rejectedWith(expectedMessage);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(client.getState()).to.equal('connectionLost');
        expect(client.connectionLostCalled).to.be.true;
    };

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

    it('should handle write command with JSON object', async () => {
        await client.handleConnect();
        mockServer.setResponse('TA 123.45 g', 'TA A 123.45 g');
        const response = await client.handleWrite({ command: 'TA' }, { value: '123.45 g' });
        expect(response).to.deep.equal({
            command: 'TA',
            status: 'OK',
            value: 123.45,
            unit: 'g',
            raw: 'TA A 123.45 g',
        });
    });

    it('should handle write command with JSON object containing a string', async () => {
        await client.handleConnect();
        mockServer.setResponse('D "Hello"', 'D A');
        const response = await client.handleWrite({ command: 'D' }, { value: 'Hello' });
        expect(response).to.deep.equal({
            success: true,
            command: 'D',
            status: 'OK',
            raw: 'D A',
        });
    });

    it('should throw error for invalid JSON object in writeData', async () => {
        await client.handleConnect();
        await expect(client.handleWrite({ command: 'TA' }, { foo: 'bar' }))
            .to.be.rejectedWith("Invalid writeData object. It must only contain a 'value' property.");
    });

    it('should handle unclean string in writeData', async () => {
        await client.handleConnect();
        mockServer.setResponse('TA 123.45 g', 'TA A 123.45 g');
        const response = await client.handleWrite({ command: 'TA' }, '  "TA   123.45   g"  ');
        expect(response).to.deep.equal({
            command: 'TA',
            status: 'OK',
            value: 123.45,
            unit: 'g',
            raw: 'TA A 123.45 g',
        });
    });

    it("should handle 'I4' response for '@' command with serial number", async () => {
        await client.handleConnect();
        mockServer.setResponse('@', 'I4 A "123456789"');
        const response = await client.handleWrite({ command: '@' });
        expect(response).to.deep.equal({
            success: true,
            command: '@',
            status: 'OK',
            serialNumber: '123456789',
            raw: 'I4 A "123456789"',
        });
    });

    it("should handle 'IA' response for '@' command with serial number", async () => {
        await client.handleConnect();
        mockServer.setResponse('@', 'IA A "987654321"');
        const response = await client.handleWrite({ command: '@' });
        expect(response).to.deep.equal({
            success: true,
            command: '@',
            status: 'OK',
            serialNumber: '987654321',
            raw: 'IA A "987654321"',
        });
    });

    it('should handle syntax error from scale', async () => {
        await client.handleConnect();
        mockServer.setResponse('S', 'ES');
        await expect(client.handleRead({ command: 'S' }))
            .to.be.rejectedWith('MT-SICS: Syntax Error');
    });
    
    it('should handle logical error from scale', async () => {
        await client.handleConnect();
        mockServer.setResponse('S', 'EL');
        await expect(client.handleRead({ command: 'S' }))
            .to.be.rejectedWith('MT-SICS: Logical Error (invalid command)');
    });

    it('should handle "command not executable" error from scale', async () => {
        await client.handleConnect();
        mockServer.setResponse('S', 'S I'); // "I" for not executable
        await expect(client.handleRead({ command: 'S' }))
            .to.be.rejectedWith('MT-SICS: Command "S" not executable.');
    });

    it('should handle overload error from scale', async () => {
        await client.handleConnect();
        mockServer.setResponse('S', 'S +');
        await expect(client.handleRead({ command: 'S' }))
            .to.be.rejectedWith('MT-SICS: Overload on command "S"');
    });

    it('should handle underload error from scale', async () => {
        await client.handleConnect();
        mockServer.setResponse('S', 'S -');
        await expect(client.handleRead({ command: 'S' }))
            .to.be.rejectedWith('MT-SICS: Underload on command "S"');
    });

    it('should handle read command for Taring', async () => {
        await client.handleConnect();
        mockServer.setResponse('T', 'T S      100.00 g');
        const response = await client.handleRead({ command: 'T' });
        expect(response).to.deep.equal({
            command: 'T',
            status: 'stable',
            value: 100.00,
            unit: 'g',
            raw: 'T S      100.00 g',
        });
    });

    it('should handle ZI command response on write', async () => {
        await client.handleConnect();
        mockServer.setResponse('ZI', 'ZI D');
        const response = await client.handleWrite({ command: 'ZI' });
        expect(response).to.deep.equal({
            command: 'ZI',
            status: 'dynamic',
            raw: 'ZI D',
        });
    });

    it('should handle PW command response', async () => {
        await client.handleConnect();
        mockServer.setResponse('PW', 'PW A      0.50 g');
        const response = await client.handleRead({ command: 'PW' });
        expect(response).to.deep.equal({
            command: 'PW',
            status: 'OK',
            value: 0.50,
            unit: 'g',
            raw: 'PW A      0.50 g',
        });
    });

    it('should handle PCS command response', async () => {
        await client.handleConnect();
        mockServer.setResponse('PCS', 'PCS S 10');
        const response = await client.handleRead({ command: 'PCS' });
        expect(response).to.deep.equal({
            command: 'PCS',
            status: 'stable',
            value: 10,
            raw: 'PCS S 10',
        });
    });

    it('should handle logical error for D command', async () => {
        await client.handleConnect();
        mockServer.setResponse('D "some text"', 'D L');
        await expect(client.handleWrite({ command: 'D' }, 'some text'))
            .to.be.rejectedWith('MT-SICS: Logical Error (invalid parameter for D)');
    });

    it('should drop the connection when a read command times out', async () => {
        await client.handleConnect();
        mockServer.setSilent(true);

        await expectTimeoutToDropConnection(
            () => client.handleRead({ command: 'S', timeout: 100 }),
            'Command "S" timed out'
        );
    }).timeout(500);

    it('should drop the connection when a write command times out', async () => {
        await client.handleConnect();
        mockServer.setSilent(true);

        await expectTimeoutToDropConnection(
            () => client.handleWrite({ command: 'Z', timeout: 100 }),
            'Command "Z" timed out'
        );
    }).timeout(500);

    it('should handle connection loss', (done) => {
        client.handleConnect().then(() => {
            client.on('connectionLost', () => {
                expect(client.getState()).to.equal('connectionLost');
                done();
            });

            // Stop the server to trigger a connection loss
            mockServer.stop().then(async () => {
                 // restart for other tests
                 port = await mockServer.start(port || 0);
            });
        });
    });
});
