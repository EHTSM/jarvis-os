const { RealLeadsEngine } = require("./realLeadsEngine.cjs");
const leadsEngine = new RealLeadsEngine();
const axios = require("axios");

async function execute(task) {
    const leads = await leadsEngine.getLeads();

    for (const lead of leads) {
    console.log("🎯 Lead:", lead.intent);

    // 👉 yaha tumhara WhatsApp system call hoga
    // example:
    // await sendWhatsAppMessage(lead.user, lead.intent);

}

    if (task.type === "start_lead_flow") {
        await axios.post("http://localhost:5678/webhook/lead-flow");
        return { success: true, message: "Lead system started 🚀" };
    }

    if (task.type === "start_content_flow") {
        await axios.post("http://localhost:5678/webhook/content-flow");
        return { success: true, message: "Content system started 🎬" };
    }

    if (task.type === "start_sales_funnel") {
        await axios.post("http://localhost:5678/webhook/sales-flow");
        return { success: true, message: "Sales funnel started 💰" };
    }

    return { success: false };
}

module.exports = { execute };