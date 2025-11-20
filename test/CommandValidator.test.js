const { expect } = require('chai');
const { validate } = require('../src/CommandValidator');

describe('CommandValidator', () => {
    it('should validate commands without arguments', () => {
        expect(validate('S')).to.be.true;
        expect(validate('SI')).to.be.true;
        expect(validate('T')).to.be.true;
        expect(validate('Z')).to.be.true;
    });

    it('should invalidate commands with unexpected arguments', () => {
        expect(validate('S', '123')).to.be.false;
        expect(validate('T', 'abc')).to.be.false;
    });

    it('should validate TA command with and without arguments', () => {
        expect(validate('TA')).to.be.true;
        expect(validate('TA', '100 g')).to.be.true;
        expect(validate('TA', '100.5 kg')).to.be.true;
        expect(validate('TA', '100')).to.be.true;
    });

    it('should invalidate TA command with wrong arguments', () => {
        expect(validate('TA', 'abc')).to.be.false;
    });

    it('should validate D command with a string argument', () => {
        expect(validate('D', 'Hello World')).to.be.true;
        expect(validate('D', '123')).to.be.true;
    });

    it('should invalidate D command without a string argument', () => {
        expect(validate('D')).to.be.false;
    });
});
