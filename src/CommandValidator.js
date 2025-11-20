const commandValidators = {
    // Commands without arguments
    S: /^S$/,
    SI: /^SI$/,
    TAC: /^TAC$/,
    T: /^T$/,
    Z: /^Z$/,
    '@': /^@$/,
    PCS: /^PCS$/,
    REF: /^REF$/,

    // Commands with optional arguments
    TA: /^TA(\s+[\d\.]+(\s+[a-zA-Z]{1,3})?)?$/,
    PW: /^PW(\s+[\d\.]+(\s+[a-zA-Z]{1,3})?)?$/,

    // Command with a string argument
    D: /^D\s+".*"$/,
};

function validate(command, data) {
    const validator = commandValidators[command];
    if (!validator) {
        // If we don't have a specific validator, we'll be optimistic.
        return true;
    }

    let fullCommand = command;
    if (data !== undefined && data !== null) {
        if (command === 'D') {
            fullCommand = `${command} "${data}"`;
        } else {
            fullCommand = `${command} ${data}`;
        }
    }

    return validator.test(fullCommand);
}

module.exports = {
    validate,
};
