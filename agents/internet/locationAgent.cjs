/**
 * Location Agent — detects user location from IP or input.
 * Uses ip-api.com (free, no key required, 45 req/min limit).
 */

const axios       = require("axios");
const rateLimiter = require("./_rateLimiter.cjs");

const IP_API_URL = "http://ip-api.com/json";
const TIMEOUT_MS = 6000;

/**
 * Look up location by IP address.
 * Omit ip to use the caller's current public IP.
 */
async function lookupIP(ip = "") {
    const url = ip ? `${IP_API_URL}/${ip}` : IP_API_URL;
    const res = await rateLimiter.gate("ip-api.com", () =>
        axios.get(url, {
            timeout: TIMEOUT_MS,
            params: { fields: "status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,query" }
        })
    );
    const d = res.data;
    if (d.status !== "success") throw new Error(d.message || "IP lookup failed");
    return {
        ip:          d.query,
        country:     d.country,
        countryCode: d.countryCode,
        region:      d.regionName,
        city:        d.city,
        zip:         d.zip,
        lat:         d.lat,
        lon:         d.lon,
        timezone:    d.timezone,
        isp:         d.isp,
        org:         d.org
    };
}

/**
 * Parse location from a plain-text input (e.g. "Mumbai, India" → structured).
 */
function parseText(locationText) {
    const parts = locationText.split(",").map(s => s.trim());
    return {
        raw:     locationText,
        city:    parts[0] || "",
        region:  parts[1] || "",
        country: parts[2] || parts[1] || ""
    };
}

async function run(task) {
    const p    = task.payload || {};
    const ip   = p.ip   || null;
    const text = p.location || p.city || task.input || null;

    try {
        if (text && !ip) {
            const parsed = parseText(text);
            return { success: true, source: "internet", type: "locationAgent", data: { ...parsed, method: "text_parse" } };
        }
        const data = await lookupIP(ip || "");
        return { success: true, source: "internet", type: "locationAgent", data: { ...data, method: "ip_lookup" } };
    } catch (err) {
        return { success: false, source: "internet", type: "locationAgent", data: { error: err.message } };
    }
}

module.exports = { lookupIP, parseText, run };
