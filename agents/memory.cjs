const shortTermMemory = [];
const longTermMemory  = [];
const SHORT_TERM_LIMIT = 10;
const LONG_TERM_LIMIT  = 500;  // without this, longTerm grows unboundedly (1 item per 10 interactions)

function memoryAgent(entry) {
    const payload = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        ...entry
    };

    shortTermMemory.push(payload);

    if (shortTermMemory.length > SHORT_TERM_LIMIT) {
        const moved = shortTermMemory.shift();
        longTermMemory.push(moved);
        if (longTermMemory.length > LONG_TERM_LIMIT) longTermMemory.shift();
    }

    return {
        status: "stored",
        short_term_count: shortTermMemory.length,
        long_term_count: longTermMemory.length
    };
}

function getMemoryState() {
    return {
        shortTerm: [...shortTermMemory],
        longTerm: [...longTermMemory]
    };
}

function clearMemoryState() {
    const cleared = {
        short_term_cleared: shortTermMemory.length,
        long_term_cleared: longTermMemory.length
    };

    shortTermMemory.length = 0;
    longTermMemory.length = 0;

    return {
        status: "cleared",
        ...cleared
    };
}

module.exports = {
    memoryAgent,
    getMemoryState,
    clearMemoryState
};
