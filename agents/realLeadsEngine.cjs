const { FiverrLeads } = require("./fiverrLeads.cjs");
const { GoogleMapsLeads } = require("./googleMapsLeads.cjs");
const { LinkedInLeads } = require("./linkedinLeads.cjs");

class RealLeadsEngine {
    constructor() {
        this.fiverr = new FiverrLeads();
        this.maps = new GoogleMapsLeads();
        this.linkedin = new LinkedInLeads();
    }

    async getLeads() {
        const fiverr = await this.fiverr.getLeads();
        const maps = await this.maps.getLeads();
        const linkedin = await this.linkedin.getLeads();

        return [...fiverr, ...maps, ...linkedin];
    }
}

module.exports = { RealLeadsEngine };