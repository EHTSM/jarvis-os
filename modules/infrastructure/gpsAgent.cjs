/**
 * GPS Agent — current location tracking per user.
 * Uses IP-based geolocation (ipapi.co) with device mock fallback.
 * In a mobile context, replace with device GPS coords via request payload.
 */

const axios = require("axios");

const _locationCache = new Map();

function _mockLocation(userId) {
    return {
        userId,
        lat:      28.6139,
        lng:      77.2090,
        city:     "New Delhi",
        region:   "Delhi",
        country:  "IN",
        accuracy: "mock",
        source:   "mock",
        timestamp: new Date().toISOString()
    };
}

async function getCurrentLocation(userId, options = {}) {
    if (!userId) return { success: false, error: "userId is required" };

    // If caller supplies explicit coordinates (e.g. from mobile client), trust them
    if (options.lat && options.lng) {
        const loc = {
            userId,
            lat:      parseFloat(options.lat),
            lng:      parseFloat(options.lng),
            city:     options.city || "Unknown",
            country:  options.country || "Unknown",
            accuracy: "device_gps",
            source:   "client",
            timestamp: new Date().toISOString()
        };
        _locationCache.set(userId, loc);
        return { success: true, location: loc };
    }

    // Return cached location if fresh (< 5 min)
    const cached = _locationCache.get(userId);
    if (cached) {
        const age = Date.now() - new Date(cached.timestamp).getTime();
        if (age < 300_000) return { success: true, location: cached, cached: true };
    }

    // IP-based geolocation fallback
    try {
        const { data } = await axios.get("https://ipapi.co/json/", { timeout: 4000 });
        const loc = {
            userId,
            lat:      data.latitude,
            lng:      data.longitude,
            city:     data.city,
            region:   data.region,
            country:  data.country_code,
            accuracy: "ip_based",
            source:   "ipapi",
            timestamp: new Date().toISOString()
        };
        _locationCache.set(userId, loc);
        return { success: true, location: loc };
    } catch (_err) {
        const mock = _mockLocation(userId);
        _locationCache.set(userId, mock);
        return { success: true, location: mock, note: "IP lookup failed — using mock" };
    }
}

function clearCache(userId) {
    if (userId) _locationCache.delete(userId);
    else _locationCache.clear();
    return { success: true };
}

module.exports = { getCurrentLocation, clearCache };
