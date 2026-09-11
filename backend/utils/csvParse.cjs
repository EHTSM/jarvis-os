"use strict";
/**
 * Minimal RFC-4180 CSV parser — shared by bulk CRM import and bulk
 * marketing import (both need real CSV parsing; one shared implementation
 * instead of two ad hoc ones). Handles quoted fields, embedded commas,
 * embedded quotes ("" escape), and embedded newlines inside quoted cells.
 * No external dependency — the codebase has no CSV parser today and this
 * is intentionally small rather than pulling in a library for ~40 lines
 * of well-understood parsing logic.
 */

function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    const s = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inQuotes) {
            if (c === '"') {
                if (s[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else {
                field += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ",") {
            row.push(field); field = "";
        } else if (c === "\n") {
            row.push(field); field = "";
            rows.push(row); row = [];
        } else {
            field += c;
        }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => !(r.length === 1 && r[0] === ""));
}

/**
 * parseCsvRecords(text) -> array of plain objects keyed by the header row.
 * Trims header/value whitespace; skips fully-empty rows.
 */
function parseCsvRecords(text) {
    const rows = parseCsv(text);
    if (!rows.length) return [];
    const headers = rows[0].map(h => String(h).trim());
    return rows.slice(1)
        .filter(r => r.some(v => String(v).trim() !== ""))
        .map(r => {
            const obj = {};
            headers.forEach((h, i) => { if (h) obj[h] = (r[i] ?? "").trim(); });
            return obj;
        });
}

module.exports = { parseCsv, parseCsvRecords };
