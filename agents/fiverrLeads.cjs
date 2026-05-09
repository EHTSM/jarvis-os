const axios = require("axios");

class FiverrLeads {
    async getLeads(query = "website developer") {
        try {
            const url = `https://www.fiverr.com/search/gigs?query=${encodeURIComponent(query)}`;

            const res = await axios.get(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0"
                }
            });

            // ⚠️ Fiverr HTML parse karna padega (basic extract)
            const data = res.data;

            const leads = [];

            // basic intent extraction (simple version)
            const matches = data.match(/"title":"(.*?)"/g);

            if (matches) {
                matches.slice(0, 5).forEach((m, i) => {
                    leads.push({
                        source: "fiverr",
                        intent: m.replace(/"title":"|"/g, ""),
                        user: "fiverr_user_" + i
                    });
                });
            }

            return leads;

        } catch (err) {
            console.log("Fiverr error:", err.message);
            return [];
        }
    }
}

module.exports = { FiverrLeads };