"use strict";
const { loadUser, flushUser, loadWorld, loadGlobal, metaLog, uid, NOW, ok, fail } = require("./_metaverseStore.cjs");

const AGENT = "crossWorldSync";

const SYNCABLE_DATA = ["avatar_appearance","inventory","wallet_balance","friends_list","achievement","preference","language"];

function exportUserState({ userId, worldId, dataTypes = SYNCABLE_DATA }) {
    if (!userId) return fail(AGENT, "userId required");
    const invalid = dataTypes.filter(d => !SYNCABLE_DATA.includes(d));
    if (invalid.length) return fail(AGENT, `invalid dataTypes: ${invalid.join(",")}. Valid: ${SYNCABLE_DATA.join(", ")}`);

    const state = { userId, worldId: worldId || null, exportedAt: NOW(), data: {} };

    if (dataTypes.includes("avatar_appearance") && worldId) {
        state.data.avatar_appearance = loadUser(userId, `avatar_${worldId}`) || null;
    }
    if (dataTypes.includes("wallet_balance")) {
        state.data.wallet_balance = loadUser(userId, "mv_wallet") || null;
    }
    if (dataTypes.includes("inventory")) {
        state.data.inventory = loadUser(userId, "digital_assets", []);
    }
    if (dataTypes.includes("friends_list")) {
        state.data.friends_list = loadUser(userId, "friends", []);
    }
    if (dataTypes.includes("achievement")) {
        state.data.achievement = loadUser(userId, "achievements", []);
    }
    if (dataTypes.includes("preference")) {
        state.data.preference = loadUser(userId, "preferences", {});
    }

    const snapshot = { snapshotId:uid("snap"), ...state };
    flushUser(userId, `sync_snapshot_${snapshot.snapshotId}`, snapshot);

    metaLog(AGENT, userId, "state_exported", { worldId, dataTypes, snapshotId: snapshot.snapshotId }, "INFO");
    return ok(AGENT, snapshot);
}

function importUserState({ userId, targetWorldId, snapshotId, dataTypes = SYNCABLE_DATA }) {
    if (!userId || !targetWorldId || !snapshotId) return fail(AGENT, "userId, targetWorldId, and snapshotId required");
    const snapshot = loadUser(userId, `sync_snapshot_${snapshotId}`);
    if (!snapshot) return fail(AGENT, `snapshotId ${snapshotId} not found`);

    const imported = {};
    if (dataTypes.includes("wallet_balance") && snapshot.data.wallet_balance) {
        flushUser(userId, "mv_wallet", snapshot.data.wallet_balance);
        imported.wallet_balance = true;
    }
    if (dataTypes.includes("inventory") && snapshot.data.inventory) {
        flushUser(userId, "digital_assets", snapshot.data.inventory);
        imported.inventory = true;
    }
    if (dataTypes.includes("preference") && snapshot.data.preference) {
        flushUser(userId, "preferences", snapshot.data.preference);
        imported.preference = true;
    }

    metaLog(AGENT, userId, "state_imported", { targetWorldId, snapshotId, imported }, "INFO");
    return ok(AGENT, { userId, targetWorldId, snapshotId, imported, importedAt:NOW() });
}

function syncFriendsList({ userId, friendId, action = "add" }) {
    if (!userId || !friendId) return fail(AGENT, "userId and friendId required");
    if (!["add","remove"].includes(action)) return fail(AGENT, "action must be add|remove");
    if (userId === friendId) return fail(AGENT, "cannot add yourself as a friend");

    let friends = loadUser(userId, "friends", []);
    if (action === "add") {
        if (!friends.includes(friendId)) friends.push(friendId);
    } else {
        friends = friends.filter(f => f !== friendId);
    }
    flushUser(userId, "friends", friends);

    metaLog(AGENT, userId, `friend_${action}`, { friendId }, "INFO");
    return ok(AGENT, { userId, friendId, action, totalFriends: friends.length });
}

function getUserPresence({ userId }) {
    if (!userId) return fail(AGENT, "userId required");
    const registry = loadGlobal("world_registry", []);
    const activeWorlds = [];

    // find worlds where user is listed
    registry.filter(w => w.status === "active").forEach(w => {
        try {
            const world = loadWorld(w.worldId);
            if (world && world.users.find(u => u.userId === userId)) {
                activeWorlds.push({ worldId: w.worldId, worldName: w.name, worldType: w.worldType });
            }
        } catch {}
    });

    return ok(AGENT, { userId, activeWorlds, totalActiveWorlds: activeWorlds.length, checkedAt:NOW() });
}

module.exports = { exportUserState, importUserState, syncFriendsList, getUserPresence };
