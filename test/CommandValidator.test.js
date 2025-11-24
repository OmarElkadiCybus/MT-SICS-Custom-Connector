const { expect } = require('chai');
const { validateReadCommand, validateWriteCommand } = require('../src/CommandValidator');

const mockLog = {
    warn: () => {},
};

describe('CommandValidator', () => {
    describe('validateReadCommand', () => {
        it('should validate known commands', () => {
            expect(validateReadCommand('S', mockLog)).to.be.true;
            expect(validateReadCommand('SI', mockLog)).to.be.true;
            expect(validateReadCommand('T', mockLog)).to.be.true;
            expect(validateReadCommand('TA', mockLog)).to.be.true;
        });

        it('should not validate unknown commands', () => {
            expect(() => validateReadCommand('FAKE', mockLog)).to.throw();
        });

        it('should not validate commands with spaces', () => {
            expect(() => validateReadCommand('S ', mockLog)).to.throw();
        });
    });

    describe('validateWriteCommand', () => {
        it('should validate commands without arguments', () => {
            expect(validateWriteCommand('S', null, mockLog)).to.be.true;
            expect(validateWriteCommand('SI', null, mockLog)).to.be.true;
            expect(validateWriteCommand('T', null, mockLog)).to.be.true;
            expect(validateWriteCommand('Z', null, mockLog)).to.be.true;
        });

        it('should invalidate commands with unexpected arguments', () => {
            expect(() => validateWriteCommand('S', '123', mockLog)).to.throw();
            expect(() => validateWriteCommand('T', 'abc', mockLog)).to.throw();
        });

        it('should validate TA and PW commands with arguments', () => {
            expect(validateWriteCommand('TA', '100 g', mockLog)).to.be.true;
            expect(validateWriteCommand('TA', '100.5 kg', mockLog)).to.be.true;
            expect(validateWriteCommand('PW', '50.0 g', mockLog)).to.be.true;
        });

        it('should invalidate TA and PW commands without arguments', () => {
            expect(() => validateWriteCommand('TA', null, mockLog)).to.throw();
            expect(() => validateWriteCommand('PW', null, mockLog)).to.throw();
        });

        it('should invalidate TA and PW commands with wrong arguments', () => {
            expect(() => validateWriteCommand('TA', 'abc', mockLog)).to.throw();
            expect(() => validateWriteCommand('TA', '100', mockLog)).to.throw();
            expect(() => validateWriteCommand('PW', 'xyz', mockLog)).to.throw();
            expect(() => validateWriteCommand('PW', '50', mockLog)).to.throw();
        });

        it('should validate D command with a string argument', () => {
            expect(validateWriteCommand('D', '"Hello World"', mockLog)).to.be.true;
            expect(validateWriteCommand('D', '"123"', mockLog)).to.be.true;
            expect(validateWriteCommand('D', '""', mockLog)).to.be.true;
        });

        it('should invalidate D command without a string argument', () => {
            expect(() => validateWriteCommand('D', null, mockLog)).to.throw();
        });
    });
});
