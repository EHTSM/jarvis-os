/**
 * Maps Agent — location lookup and directions.
 * Uses Google Maps Geocoding / Directions API with structured mock fallback.
 */

const axios = require("axios");

const MAPS_KEY = process.env.GOOGLE_MAPS_KEY;
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json";

function _mockLocation(query) {
    return {
        address:     query,
        lat:         28.6139 + Math.random() * 0.01,
        lng:         77.2090 + Math.random() * 0.01,
        placeId:     `mock_${Date.now()}`,
        source:      "mock"
    };
}

function _mockDirections(from, to) {
    const distance = Math.round(3 + Math.random() * 20);
    const duration = Math.round(distance * 3);
    return {
        from, to,
        distance:    `${distance} km`,
        duration:    `${duration} min`,
        steps:       [`Head towards ${to}`, `Continue on main road`, `Arrive at ${to}`],
        source:      "mock"
    };
}

async function getLocation(query) {
    if (!query) return { success: false, error: "Query is required" };

    if (!MAPS_KEY) {
        return { success: true, location: _mockLocation(query), note: "Mock — set GOOGLE_MAPS_KEY for real data" };
    }

    try {
        const { data } = await axios.get(GEOCODE_URL, {
            params: { address: query, key: MAPS_KEY }
        });

        if (data.status !== "OK" || !data.results.length) {
            return { success: false, error: `Maps API: ${data.status}` };
        }

        const r = data.results[0];
        return {
            success:  true,
            location: {
                address:  r.formatted_address,
                lat:      r.geometry.location.lat,
                lng:      r.geometry.location.lng,
                placeId:  r.place_id,
                source:   "google_maps"
            }
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function getDirections(from, to, mode = "driving") {
    if (!from || !to) return { success: false, error: "from and to are required" };

    if (!MAPS_KEY) {
        return { success: true, directions: _mockDirections(from, to), note: "Mock — set GOOGLE_MAPS_KEY for real data" };
    }

    try {
        const { data } = await axios.get(DIRECTIONS_URL, {
            params: { origin: from, destination: to, mode, key: MAPS_KEY }
        });

        if (data.status !== "OK" || !data.routes.length) {
            return { success: false, error: `Directions API: ${data.status}` };
        }

        const leg = data.routes[0].legs[0];
        return {
            success:    true,
            directions: {
                from:     leg.start_address,
                to:       leg.end_address,
                distance: leg.distance.text,
                duration: leg.duration.text,
                steps:    leg.steps.map(s => s.html_instructions.replace(/<[^>]+>/g, "")),
                source:   "google_maps"
            }
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { getLocation, getDirections };
