const readCommandValidators = {
    S: /^S$/,
    SI: /^SI$/,
    TA: /^TA$/,
    PCS: /^PCS$/,
    PW: /^PW$/,
    '@': /^@$/,
    T: /^T$/,
    Z: /^Z$/,
    ZI: /^ZI$/,
    D: /^D$/,
    TAC: /^TAC$/,
    REF: /^REF$/,
};

const writeCommandValidators = {
    S: /^S$/,
    SI: /^SI$/,
    TAC: /^TAC$/,
    T: /^T$/,
    Z: /^Z$/,
    ZI: /^ZI$/,
    '@': /^@$/,
    PCS: /^PCS$/,
    REF: /^REF$/,

    // Commands with optional arguments, but require unit if value is present
    TA: /^TA\s+[\d.]+\s+[a-zA-Z]{1,3}$/,
    PW: /^PW\s+[\d.]+\s+[a-zA-Z]{1,3}$/,

    // Command with a string argument
    D: /^D\s+".*"$/,
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
        log.warn(`[CommandValidator] Unknown write command: ${command}`);
        return false;
    }

    let fullCommand = command;
    if (data !== undefined && data !== null) {
        if (command === 'D') {
            fullCommand = `${command} "${data}"`;
        } else if (String(data).length > 0) {
            fullCommand = `${command} ${data}`;
        }
    }

    const isValid = validator.test(fullCommand);
    if (!isValid) {
        log.warn(`[CommandValidator] Invalid write command: ${fullCommand}`);
    }
    return isValid;
}

module.exports = {
    validateReadCommand,
    validateWriteCommand,
};
