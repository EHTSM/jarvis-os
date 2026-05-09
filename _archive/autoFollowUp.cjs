const { getLeads, updateLead } = require("./crm.cjs");
const { sendWhatsApp } = require("../utils/whatsapp.cjs");

async function runFollowUp() {
    const leads = getLeads();

    for (let lead of leads) {
        if (lead.status === "interested") {
            await sendWhatsApp(
                lead.phone,
                "Hey 👋 just checking — ready to start?"
            );

            updateLead(lead.phone, { status: "followed" });
        }
    }
}

module.exports = { runFollowUp };