const axios = require("axios");

async function runWorkflow(name, data = {}) {
    try {
        const res = await axios.post(`http://localhost:5678/webhook/${name}`, data, {
            headers: { "Content-Type": "application/json" },
            timeout: 10000
        });
        return res.data?.message || "Workflow executed";
    } catch (err) {
        console.error("n8n error:", err.message);
        return "Workflow failed";
    }
}

module.exports = { runWorkflow };
