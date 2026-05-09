const axios = require("axios");

const SERP_API_KEY = "75b579ba8cc2517b7924ea4ac5908d5b8d9c9c4489200cf6e39c04926f0a32e4";

function cleanQuery(command = "") {
  return command
    .toLowerCase()
    .replace(/find/g, "")
    .replace(/leads?/g, "")
    .replace(/in/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchLeads(command = "") {
  try {
    if (!command || typeof command !== "string") {
      return { error: "❌ Invalid command input" };
    }

    const cleanedQuery = cleanQuery(command);

    if (!cleanedQuery) {
      return { error: "❌ Query empty after cleaning" };
    }

    console.log("🔍 Final Query:", cleanedQuery);

   const response = await axios.get("https://serpapi.com/search.json", {
  params: {
    q: cleanedQuery,
    engine: "google",
    api_key: SERP_API_KEY,
    location: "Delhi, India"   // ✅ comma fix
  }
});

    const results = response.data.organic_results || [];

    const leads = results.slice(0, 10).map(item => ({
      title: item.title || "",
      link: item.link || "",
      snippet: item.snippet || ""
    }));

    return {
      success: true,
      leads
    };

  } catch (err) {
    return {
      error: err.response?.data || err.message
    };
  }
}

module.exports = fetchLeads;