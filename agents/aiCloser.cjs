const axios = require("axios");

class AICloser {
    async generateMessage(lead) {
        const name = lead.name || "there";

        return `Hi ${name},  
I saw your profile/business and noticed you might need help with growth 🚀  

We help businesses get more clients using automation + AI systems.  

Would you like a quick demo?`;
    }

    async sendWhatsApp(phone, message) {
        try {
            await axios.post(
                "https://graph.facebook.com/v18.0/YOUR_PHONE_NUMBER_ID/messages",
                {
                    messaging_product: "whatsapp",
                    to: phone,
                    type: "text",
                    text: { body: message }
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                        "Content-Type": "application/json"
                    }
                }
            );

            return true;
        } catch (err) {
            console.log("WhatsApp error:", err.message);
            return false;
        }
    }
}

module.exports = { AICloser };