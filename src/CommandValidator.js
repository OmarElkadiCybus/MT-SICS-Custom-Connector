const readCommandValidators = {
    S: /^S$/,
    SI: /^SI$/,
    T: /^T$/,
    TA: /^TA$/,
    PCS: /^PCS$/,
    PW: /^PW$/,
    '@': /^@$/,
};

const writeCommandValidators = {
    S: /^S$/,
    SI: /^SI$/,
    TAC: /^TAC$/,
    T: /^T$/,
    Z: /^Z$/,
    ZI: /^ZI$/,
    '@': /^@$/,
    REF: /^REF(\s+\d+)?$/,

    // Commands with optional arguments, but require unit if value is present
    TA: /^TA(\s+[\d.]+\s+(g|kg))$/,
    PW: /^PW(\s+[\d.]+\s+(g|kg))$/,

    // Command with a string argument
    D: /^D\s+.*$/,
};

const WriteCommandExamples = {
    S: ["S"],
    SI: ["SI"],
    TAC: ["TAC"],
    T: ["T"],
    Z: ["Z"],
    ZI: ["ZI"],
    '@': ["@"],
    REF: ["REF", "REF 10"],
    TA: ["TA 100 g", "TA 0.5 kg"],
    PW: ["PW 50 kg", "PW 200 g"],
    D: ["D \"hello world\"", "D x142"],
};
function validateReadCommand(command, log) {
    const validator = readCommandValidators[command];
    if (!validator) {
        throw new Error(`[CommandValidator] Unknown read command: ${command}`);
    }
    const isValid = validator.test(command);
    if (!isValid) {
        throw new Error(`[CommandValidator] Invalid read command: ${command}, expected format: ${validator}`);
    }
    return true;
}

function validateWriteCommand(command, data, log) {
    const validator = writeCommandValidators[command];
    if (!validator) {
        throw new Error(`[CommandValidator] Unknown write command: ${command}`);
    }

    let fullCommand = command;
    if (data !== undefined && data !== null) {
        fullCommand = `${command} ${data}`;
    }

    const isValid = validator.test(fullCommand);
    if (!isValid) {
        throw new Error(`[CommandValidator] Invalid write command/payload: ${fullCommand}, expected format: ${validator}, examples: ${JSON.stringify(WriteCommandExamples[command])}`);
    }
    return true;
}

module.exports = {
    validateReadCommand,
    validateWriteCommand,
};
