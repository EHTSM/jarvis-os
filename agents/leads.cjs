const axios = require("axios");

async function getLeads(query) {
    const API_KEY = process.env.GOOGLE_API;

    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${API_KEY}`;

    const res = await axios.get(url);

    return res.data.results.map(place => ({
        name: place.name,
        address: place.formatted_address
    }));
}

module.exports = { getLeads };