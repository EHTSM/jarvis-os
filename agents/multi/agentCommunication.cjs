/**
 * Agent Communication — message bus for agent-to-agent messaging.
 * Agents publish messages; other agents subscribe by topic.
 */

const _bus      = new Map(); // topic → Set<callback>
const _inbox    = new Map(); // agentName → message[]
const _msgLog   = [];        // global message history (last 500)
const MAX_LOG   = 500;
const MAX_INBOX = 100;

function subscribe(topic, callback) {
    if (!_bus.has(topic)) _bus.set(topic, new Set());
    _bus.get(topic).add(callback);
    return () => unsubscribe(topic, callback); // returns unsubscribe fn
}

function unsubscribe(topic, callback) {
    _bus.get(topic)?.delete(callback);
}

async function publish(topic, payload, fromAgent = "system") {
    const msg = {
        id:        `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ts:        new Date().toISOString(),
        topic,
        from:      fromAgent,
        payload
    };

    _msgLog.push(msg);
    if (_msgLog.length > MAX_LOG) _msgLog.shift();

    const subs = _bus.has(topic) ? [..._bus.get(topic)] : [];
    const settled = await Promise.allSettled(subs.map(cb => cb(msg)));

    return { success: true, messageId: msg.id, delivered: subs.length, topic };
}

// Direct message to a named agent's inbox
function send(toAgent, payload, fromAgent = "system") {
    if (!_inbox.has(toAgent)) _inbox.set(toAgent, []);
    const inbox = _inbox.get(toAgent);
    inbox.push({ ts: new Date().toISOString(), from: fromAgent, payload });
    if (inbox.length > MAX_INBOX) inbox.shift();
    return { success: true, to: toAgent, from: fromAgent };
}

function readInbox(agentName, clear = true) {
    const msgs = _inbox.get(agentName) || [];
    if (clear) _inbox.set(agentName, []);
    return msgs;
}

function getHistory(limit = 20) {
    return _msgLog.slice(-limit);
}

module.exports = { subscribe, unsubscribe, publish, send, readInbox, getHistory };
