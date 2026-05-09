const { getLeads } = require("../agents/crm.cjs");
const { sendWhatsApp } = require("./whatsapp.cjs");

async function sendBulk(message) {
    const leads = getLeads();

    for (let lead of leads) {
        await sendWhatsApp(lead.phone, message);
    }

    console.log("✅ Bulk sent");
}

module.exports = { sendBulk };