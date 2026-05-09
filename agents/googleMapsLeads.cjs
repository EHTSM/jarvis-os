const axios = require("axios");

class GoogleMapsLeads {
    constructor() {
        this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
    }

    async getLeads(query = "digital marketing agency", location = "India") {
        try {
            const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query + " " + location)}&key=${this.apiKey}`;

            const res = await axios.get(url);

            const leads = res.data.results.map(place => ({
                name: place.name,
                address: place.formatted_address,
                rating: place.rating,
                source: "google_maps"
            }));

            return leads;

        } catch (err) {
            console.log("Maps error:", err.message);
            return [];
        }
    }
}

module.exports = { GoogleMapsLeads };