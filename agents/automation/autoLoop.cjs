/**
 * Auto loop helpers for background automation jobs.
 * CommonJS module by design.
 */

function createAutoLoop(handler, intervalMs = 60000) {
    if (typeof handler !== "function") {
        throw new TypeError("createAutoLoop requires a function handler");
    }

    let timer = null;

    return {
        start() {
            if (timer) return false;
            timer = setInterval(handler, intervalMs);
            return true;
        },
        stop() {
            if (!timer) return false;
            clearInterval(timer);
            timer = null;
            return true;
        },
        isRunning() {
            return timer !== null;
        }
    };
}

module.exports = {
    createAutoLoop
};
