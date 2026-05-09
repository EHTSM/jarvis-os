/**
 * Chat System Agent — tenant-isolated internal messaging.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

function sendMessage({ tenantId, userId, channelId, content, mentions = [] }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("chatSystemAgent", auth.error);
    if (!content?.trim()) return fail("chatSystemAgent", "content required");

    const msg = { id: uid("msg"), tenantId, channelId, from: userId, content: content.slice(0, 2000), mentions, edited: false, sentAt: NOW() };
    const store = load(tenantId, `chat-${channelId}`, []);
    store.push(msg);
    flush(tenantId, `chat-${channelId}`, store.slice(-500));
    return ok("chatSystemAgent", msg);
}

function createChannel({ tenantId, userId, name, type = "public", members = [] }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("chatSystemAgent", auth.error);

    const channels = load(tenantId, "chat-channels", []);
    if (channels.some(c => c.name === name)) return fail("chatSystemAgent", `Channel #${name} already exists`);

    const ch = { id: uid("ch"), tenantId, name, type, members: [...new Set([userId, ...members])], createdBy: userId, createdAt: NOW() };
    channels.push(ch);
    flush(tenantId, "chat-channels", channels);
    auditLog(tenantId, userId, "channel_created", { name, type });
    return ok("chatSystemAgent", ch);
}

function getMessages(tenantId, requesterId, channelId, limit = 50) {
    const auth = requireAuth(tenantId, requesterId, "employee");
    if (!auth.ok) return forbidden("chatSystemAgent", auth.error);

    const msgs = load(tenantId, `chat-${channelId}`, []);
    return ok("chatSystemAgent", { channelId, messages: msgs.slice(-limit).reverse(), total: msgs.length });
}

function listChannels(tenantId, requesterId) {
    const auth = requireAuth(tenantId, requesterId, "employee");
    if (!auth.ok) return forbidden("chatSystemAgent", auth.error);
    return ok("chatSystemAgent", { channels: load(tenantId, "chat-channels", []) });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "send_message")    return sendMessage(p);
        if (task.type === "create_channel")  return createChannel(p);
        if (task.type === "get_messages")    return getMessages(p.tenantId, p.userId, p.channelId, p.limit);
        return listChannels(p.tenantId, p.userId);
    } catch (err) { return fail("chatSystemAgent", err.message); }
}

module.exports = { sendMessage, createChannel, getMessages, listChannels, run };
