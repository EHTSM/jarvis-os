/**
 * Agent Versioning — tracks versions of agents and allows safe updates.
 */

const fs           = require("fs");
const path         = require("path");
const agentManager = require("./agentManager.cjs");

const VERSION_FILE = path.join(__dirname, "../../data/agent-versions.json");

function _load() {
    try {
        if (!fs.existsSync(VERSION_FILE)) return {};
        return JSON.parse(fs.readFileSync(VERSION_FILE, "utf8"));
    } catch { return {}; }
}

function _save(data) {
    const dir = path.dirname(VERSION_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(VERSION_FILE, JSON.stringify(data, null, 2));
}

function getVersion(agentName) {
    const store = _load();
    return store[agentName] || null;
}

function setVersion(agentName, version, changelog = "") {
    const store = _load();
    if (!store[agentName]) store[agentName] = { current: null, history: [] };

    const prev = store[agentName].current;
    if (prev) store[agentName].history.push({ version: prev.version, retiredAt: new Date().toISOString() });

    store[agentName].current = { version, changelog, updatedAt: new Date().toISOString() };
    _save(store);

    return { success: true, agentName, version, previous: prev?.version || null };
}

function bumpVersion(agentName, type = "patch", changelog = "") {
    const entry = getVersion(agentName) || { current: { version: "1.0.0" } };
    const [major, minor, patch] = (entry.current?.version || "1.0.0").split(".").map(Number);
    const next =
        type === "major" ? `${major + 1}.0.0` :
        type === "minor" ? `${major}.${minor + 1}.0` :
                           `${major}.${minor}.${patch + 1}`;
    return setVersion(agentName, next, changelog);
}

function listVersions() {
    const store = _load();
    return Object.entries(store).map(([name, v]) => ({
        name,
        current:  v.current?.version || "unknown",
        updatedAt: v.current?.updatedAt,
        changelog: v.current?.changelog,
        historyCount: v.history?.length || 0
    }));
}

module.exports = { getVersion, setVersion, bumpVersion, listVersions };
