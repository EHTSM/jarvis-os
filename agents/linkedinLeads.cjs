const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");

class LinkedInLeads {
    constructor() {
        this.cookie = process.env.LINKEDIN_COOKIE;
        const proxyUrl = process.env.LINKEDIN_PROXY_URL;
        this.agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;
    }

    async getLeads(query = "founder startup") {
        try {
            const url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`;

            const res = await axios.get(url, {
                httpsAgent: this.agent,
                headers: {
                    "cookie": this.cookie,
                    "user-agent": "Mozilla/5.0"
                }
            });

            return res.data;

        } catch (err) {
            console.log("LinkedIn error:", err.message);
            return [];
        }
    }
}

module.exports = { LinkedInLeads };