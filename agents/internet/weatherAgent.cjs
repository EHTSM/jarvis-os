/**
 * Weather Agent — current weather + 3-day forecast.
 * Uses Open-Meteo (free, no API key) + ip-api.com for auto-location.
 * Falls back to OpenWeatherMap if OPENWEATHER_API_KEY is set.
 */

const axios        = require("axios");
const rateLimiter  = require("./_rateLimiter.cjs");
const locationAgent = require("./locationAgent.cjs");

const TIMEOUT_MS = 8000;

// WMO weather code → description
const WMO_CODES = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Icy fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow",
    80: "Rain showers", 81: "Heavy showers", 82: "Violent showers",
    95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Heavy thunderstorm with hail"
};

function _wmoDesc(code) { return WMO_CODES[code] || `Weather code ${code}`; }

/**
 * Fetch weather from Open-Meteo for given coordinates.
 */
async function _openMeteo(lat, lon) {
    const url = "https://api.open-meteo.com/v1/forecast";
    const res = await rateLimiter.gate("api.open-meteo.com", () =>
        axios.get(url, {
            timeout: TIMEOUT_MS,
            params: {
                latitude:  lat,
                longitude: lon,
                current:   "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weathercode",
                daily:     "weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum",
                timezone:  "auto",
                forecast_days: 3
            }
        })
    );
    const d  = res.data;
    const c  = d.current || {};
    const dy = d.daily   || {};

    const current = {
        temp:        c.temperature_2m,
        feelsLike:   c.apparent_temperature,
        humidity:    c.relative_humidity_2m,
        windSpeed:   c.wind_speed_10m,
        condition:   _wmoDesc(c.weathercode),
        unit:        "°C"
    };

    const forecast = (dy.time || []).map((date, i) => ({
        date,
        condition:   _wmoDesc(dy.weathercode?.[i]),
        tempMax:     dy.temperature_2m_max?.[i],
        tempMin:     dy.temperature_2m_min?.[i],
        rain:        dy.precipitation_sum?.[i] || 0
    }));

    return { current, forecast, source: "open-meteo" };
}

/**
 * Fetch weather using OpenWeatherMap (requires OPENWEATHER_API_KEY).
 */
async function _openWeatherMap(lat, lon) {
    const key = process.env.OPENWEATHER_API_KEY;
    if (!key) return null;
    const res = await rateLimiter.gate("api.openweathermap.org", () =>
        axios.get("https://api.openweathermap.org/data/2.5/weather", {
            timeout: TIMEOUT_MS,
            params: { lat, lon, appid: key, units: "metric" }
        })
    );
    const d = res.data;
    return {
        current: {
            temp:      d.main?.temp,
            feelsLike: d.main?.feels_like,
            humidity:  d.main?.humidity,
            windSpeed: d.wind?.speed,
            condition: d.weather?.[0]?.description,
            unit:      "°C"
        },
        forecast: [],
        source: "openweathermap"
    };
}

/**
 * Get weather for a city name or auto-detect from caller IP.
 * @param {string|null} location  City name or null for auto-detect
 */
async function getWeather(location = null) {
    let lat, lon, locationName;

    if (location) {
        // Geocode via Open-Meteo's geocoding endpoint (free, no key)
        const geoRes = await rateLimiter.gate("geocoding-api.open-meteo.com", () =>
            axios.get("https://geocoding-api.open-meteo.com/v1/search", {
                timeout: TIMEOUT_MS,
                params: { name: location, count: 1, language: "en", format: "json" }
            })
        );
        const match = geoRes.data?.results?.[0];
        if (!match) throw new Error(`Location not found: "${location}"`);
        lat          = match.latitude;
        lon          = match.longitude;
        locationName = `${match.name}, ${match.country}`;
    } else {
        // Auto-detect from IP
        const loc = await locationAgent.lookupIP();
        lat          = loc.lat;
        lon          = loc.lon;
        locationName = `${loc.city}, ${loc.country}`;
    }

    const weather = await _openWeatherMap(lat, lon) || await _openMeteo(lat, lon);

    return { location: locationName, lat, lon, ...weather };
}

async function run(task) {
    const p        = task.payload || {};
    const location = p.city || p.location || task.input || null;

    try {
        const data = await getWeather(location);
        return { success: true, source: "internet", type: "weatherAgent", data };
    } catch (err) {
        return { success: false, source: "internet", type: "weatherAgent", data: { error: err.message } };
    }
}

module.exports = { getWeather, run };
