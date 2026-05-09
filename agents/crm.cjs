const fs   = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../data/leads.json");

function _read() {
    try {
        if (!fs.existsSync(FILE)) return [];
        const raw = fs.readFileSync(FILE, "utf-8").trim();
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function _write(data) {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function saveLead(lead) {
    const data = _read();
    // Avoid duplicate by phone
    const exists = lead.phone && data.some(l => l.phone === lead.phone);
    if (!exists) {
        data.push({ ...lead, status: "new", createdAt: new Date().toISOString() });
        _write(data);
    }
}

function updateLead(phone, updates) {
    const data = _read();
    const updated = data.map(l =>
        l.phone === phone ? { ...l, ...updates, updatedAt: new Date().toISOString() } : l
    );
    _write(updated);
}

function getLeads() {
    return _read();
}

module.exports = { saveLead, updateLead, getLeads };
