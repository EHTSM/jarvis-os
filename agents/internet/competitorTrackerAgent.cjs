/**
 * Competitor Tracker Agent — monitors competitor websites for changes.
 * Extracts key signals: title, description, headings, pricing mentions, new pages.
 * Stores a snapshot to data/competitor-snapshots.json for delta detection.
 */

const fs          = require("fs");
const path        = require("path");
const webScraper  = require("./webScraperAgent.cjs");

const SNAPSHOT_FILE = path.join(__dirname, "../../data/competitor-snapshots.json");

function _loadSnapshots() {
    try {
        if (fs.existsSync(SNAPSHOT_FILE)) return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
    } catch { /* start fresh */ }
    return {};
}

function _saveSnapshots(data) {
    fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(data, null, 2));
}

function _fingerprint(scraped) {
    return [scraped.title, ...(scraped.h1 || []), ...(scraped.h2 || [])].join("|");
}

function _detectChanges(old, current) {
    const changes = [];
    if (old.title !== current.title)           changes.push({ field: "title",       old: old.title,       new: current.title });
    if (old.description !== current.description) changes.push({ field: "description", old: old.description, new: current.description });

    const oldH1 = new Set(old.h1 || []);
    const newH1 = (current.h1 || []).filter(h => !oldH1.has(h));
    if (newH1.length) changes.push({ field: "new_headings", items: newH1 });

    return changes;
}

/**
 * Track a competitor URL — scrape, compare to last snapshot, return delta.
 */
async function track(url) {
    const scraped   = await webScraper.scrape(url);
    const snapshots = _loadSnapshots();
    const snapshot  = snapshots[url];
    const now       = new Date().toISOString();

    const result = {
        url,
        title:       scraped.title,
        description: scraped.description,
        h1:          scraped.h1,
        h2:          scraped.h2,
        links:       scraped.links,
        trackedAt:   now,
        changes:     [],
        isFirstScan: !snapshot
    };

    if (snapshot) {
        result.changes  = _detectChanges(snapshot, scraped);
        result.lastScan = snapshot.trackedAt;
    }

    // Save new snapshot
    snapshots[url] = { title: scraped.title, description: scraped.description, h1: scraped.h1, h2: scraped.h2, trackedAt: now };
    _saveSnapshots(snapshots);

    return result;
}

/**
 * Track multiple competitor URLs and return consolidated report.
 */
async function trackMany(urls) {
    const results = [];
    for (const url of urls.slice(0, 5)) {
        try {
            results.push({ url, success: true, data: await track(url) });
        } catch (err) {
            results.push({ url, success: false, error: err.message });
        }
    }
    const changesFound = results.filter(r => r.success && r.data.changes?.length > 0);
    return {
        tracked: results.length,
        withChanges: changesFound.length,
        results,
        summary: changesFound.length > 0
            ? `${changesFound.length} competitor(s) updated since last check`
            : "No changes detected since last scan"
    };
}

/** List all tracked URLs and their last-scan time. */
function listTracked() {
    const snapshots = _loadSnapshots();
    return Object.entries(snapshots).map(([url, s]) => ({ url, lastScan: s.trackedAt, title: s.title }));
}

async function run(task) {
    const p    = task.payload || {};
    const url  = p.url || task.input || "";
    const urls = p.urls || (url ? [url] : []);

    if (!urls.length) return { success: false, source: "internet", type: "competitorTrackerAgent", data: { error: "url or urls[] required" } };

    try {
        const data = urls.length === 1 ? await track(urls[0]) : await trackMany(urls);
        return { success: true, source: "internet", type: "competitorTrackerAgent", data };
    } catch (err) {
        return { success: false, source: "internet", type: "competitorTrackerAgent", data: { error: err.message } };
    }
}

module.exports = { track, trackMany, listTracked, run };
