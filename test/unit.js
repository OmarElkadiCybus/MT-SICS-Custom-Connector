const chai = require('chai');
const chaiAsPromised = require("chai-as-promised");
const MtsicsClient = require('../src/Client.js');
const MtsicsConnection = require('../src/MtsicsConnection.js');
const MockScaleServer = require('./mock-scale-server.js');

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Unit Tests', () => {
    describe('MtsicsClient', () => {
        const mockServer = new MockScaleServer();
        const port = 9001;
        let client;

        before(async () => {
            await mockServer.start(port);
        });

        after(async () => {
            await mockServer.stop();
        });

        beforeEach(() => {
            client = new MtsicsClient({ host: 'localhost', port });
            mockServer.clearResponses();
        });

        afterEach(() => {
            if (client) {
                client.end();
            }
        });

        it('should connect to the mock server', async () => {
            await client.connect();
        });

        it('should send a command and receive a response', async () => {
            await client.connect();
            mockServer.setResponse('S', 'S S 100.0 g');
            const response = await client.sendCommand('S');
            expect(response).to.equal('S S 100.0 g');
        });

        it('should queue commands and execute them sequentially', async () => {
            await client.connect();
            mockServer.setResponse('S', 'S S 100.0 g');
            mockServer.setResponse('T', 'T A');

            const promiseS = client.sendCommand('S');
            const promiseT = client.sendCommand('T');

            const [responseS, responseT] = await Promise.all([promiseS, promiseT]);

            expect(responseS).to.equal('S S 100.0 g');
            expect(responseT).to.equal('T A');
        });
    });

    describe('MtsicsConnection', () => {
        const connection = new MtsicsConnection({ connection: {} });

        it('should parse stable weight response correctly', () => {
            const response = 'S S 123.45 g';
            const parsed = connection._parseResponse('S', response);
            expect(parsed).to.deep.equal({
                weight_value: 123.45,
                weight_unit: 'g',
                weight_status: 'OK',
            });
        });

        it('should parse unstable weight response correctly', () => {
            const response = 'S D 123.45 g';
            const parsed = connection._parseResponse('S', response);
            expect(parsed).to.deep.equal({
                weight_value: 123.45,
                weight_unit: 'g',
                weight_status: 'KO',
            });
        });

        it('should parse tare response correctly', () => {
            const response = 'TA A 12.3 g';
            const parsed = connection._parseResponse('TA', response);
            expect(parsed).to.deep.equal({
                tare_value: 12.3,
                tare_unit: 'g',
                tare_status: 'OK',
            });
        });
        
        it('should parse empty tare response correctly', () => {
            const response = 'TA A';
            const parsed = connection._parseResponse('TA', response);
            expect(parsed).to.deep.equal({
                tare_value: 0,
                tare_unit: null,
                tare_status: 'OK',
            });
        });

        it('should parse piece count response correctly', () => {
            const response = 'PCS S 10';
            const parsed = connection._parseResponse('PCS', response);
            expect(parsed).to.deep.equal({
                count_quantity: 10,
                count_status: 'OK',
            });
        });

        it('should parse write command response correctly', () => {
            const response = 'T A';
            const parsed = connection._parseResponse('T', response);
            expect(parsed).to.deep.equal({
                command: 'T',
                status: 'OK',
                raw: 'T A',
            });
        });

        it('should return empty data for null response', () => {
            const parsed = connection._parseResponse('S', null);
            expect(parsed).to.deep.equal({
                weight_value: null,
                weight_unit: null,
                weight_status: 'KO',
            });
        });
    });
});
