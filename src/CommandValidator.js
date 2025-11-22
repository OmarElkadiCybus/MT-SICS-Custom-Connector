const readCommandValidators = {
    S: /^S$/,
    SI: /^SI$/,
    TA: /^TA$/,
    PCS: /^PCS$/,
    PW: /^PW$/,
    '@': /^@$/,
};

const writeCommandValidators = {
    TAC: /^TAC$/,
    T: /^T$/,
    Z: /^Z$/,
    ZI: /^ZI$/,
    '@': /^@$/,
    REF: /^REF$/,

    // Commands with optional arguments, but require unit if value is present
    TA: /^TA(\s+[\d.]+\s+(g|kg))$/,
    PW: /^PW(\s+[\d.]+\s+(g|kg))$/,

    // Command with a string argument
    D: /^D\s+.*$/,
};

function validateReadCommand(command, log) {
    const validator = readCommandValidators[command];
    const isValid = validator ? validator.test(command) : false;
    if (!isValid) {
        log.warn(`[CommandValidator] Invalid read command: ${command}`);
    }
    return isValid;
}

function validateWriteCommand(command, data, log) {
    const validator = writeCommandValidators[command];
    if (!validator) {
        throw new Error(`[CommandValidator] Unknown write command: ${command}`);
    }

    let fullCommand = command;
   
    if (command === 'TA' || command === 'PW' || command === 'D') {
        if (data !== undefined && data !== null && String(data).length > 0) {
            fullCommand = `${command} ${data}`;
        }
    }


    const isValid = validator.test(fullCommand);
    if (!isValid) {
        throw new Error(`[CommandValidator] Invalid write command: "${fullCommand}" expected format: ${validator}`);
    }
    return isValid;
}

module.exports = {
    validateReadCommand,
    validateWriteCommand,
};
