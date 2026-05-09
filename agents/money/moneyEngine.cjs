const axios = require("axios");

async function moneyEngine(input) {

    if (input.includes("client") || input.includes("lead")) {
        return {
            type: "lead_generation",
            action: "start_lead_flow"
        };
    }

    if (input.includes("video") || input.includes("content")) {
        return {
            type: "content_creation",
            action: "start_content_flow"
        };
    }

    if (input.includes("sell") || input.includes("product")) {
        return {
            type: "sales",
            action: "start_sales_funnel"
        };
    }

    return null;
}

module.exports = { moneyEngine };