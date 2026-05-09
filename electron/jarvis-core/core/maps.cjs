const axios = require("axios");

const SERP_API_KEY = "75b579ba8cc2517b7924ea4ac5908d5b8d9c9c4489200cf6e39c04926f0a32e4";

async function fetchMapsLeads(query) {
  try {

    const response = await axios.get("https://serpapi.com/search.json", {
      params: {
        engine: "google_maps",
        q: query,
        api_key: SERP_API_KEY
      }
    });

    const results = response.data.local_results || [];

    const leads = results.slice(0, 10).map(place => ({
      name: place.title,
      address: place.address,
      phone: place.phone,
      website: place.website
    }));

    return {
      success: true,
      leads
    };

  } catch (err) {
    return {
      error: err.message
    };
  }
}

module.exports = fetchMapsLeads;