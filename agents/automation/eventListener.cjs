/**
 * Event Listener — pub/sub bus for user, system, and webhook events.
 * Extend: pass Express req body to handleWebhook() from any route.
 */

const logManager = require("./logManager.cjs");

const _listeners = {}; // event → Set<callback>
const _history   = []; // last 200 emitted events
const MAX_HISTORY = 200;

function on(event, callback) {
    if (!_listeners[event]) _listeners[event] = new Set();
    _listeners[event].add(callback);
    logManager.debug("EventListener.on", { event });
    return () => off(event, callback); // returns unsubscribe fn
}

function off(event, callback) {
    _listeners[event]?.delete(callback);
}

function once(event, callback) {
    const wrapper = async (payload) => {
        off(event, wrapper);
        return callback(payload);
    };
    return on(event, wrapper);
}

async function emit(event, payload = {}) {
    logManager.info("EventListener.emit", { event });

    const entry = { ts: new Date().toISOString(), event, payload };
    _history.push(entry);
    if (_history.length > MAX_HISTORY) _history.shift();

    const callbacks = _listeners[event] ? [..._listeners[event]] : [];
    if (callbacks.length === 0) {
        logManager.debug("EventListener: no listeners", { event });
    }

    const settled = await Promise.allSettled(callbacks.map(cb => cb(payload)));
    return {
        success:  true,
        event,
        handled:  callbacks.length,
        results:  settled.map(r => ({ status: r.status, reason: r.reason?.message }))
    };
}

async function handleWebhook(body = {}) {
    const event   = body.event || body.type || body.action || "webhook";
    const payload = { ...body, received_at: new Date().toISOString() };
    logManager.info("Webhook received", { event });
    return emit(event, payload);
}

function getHistory(limit = 20) {
    return _history.slice(-limit);
}

module.exports = { on, off, once, emit, handleWebhook, getHistory };
