const axios = require("axios");

class SalesAgent {
    scoreLead(text) {
        let score = 0;
        if (text.includes("price") || text.includes("cost")) score += 3;
        if (text.includes("interested") || text.includes("yes")) score += 5;
        if (text.includes("buy") || text.includes("start")) score += 7;
        return score;
    }

    async generateReply(userMessage, context = []) {
        const text = userMessage.toLowerCase();
        const score = this.scoreLead(text);

        // Objection handling
        if (text.includes("expensive") || text.includes("costly")) {
            return `I get that 👍\n\nBut most users recover this in 2-3 days.\n\nIt's not expense — it's an income system.\n\nDo you want results or just information?`;
        }

        if (text.includes("trust") || text.includes("scam")) {
            return `Fair question 👀\n\nYou don't need to trust blindly.\n\nI'll guide you step-by-step and you'll see real results.\n\nWant to test it first?`;
        }

        // Fast rule engine
        if (text.includes("price") || text.includes("cost")) {
            return `Great question 👀\n\nThis system helps you:\n✅ Get leads automatically\n✅ Close clients on WhatsApp\n✅ Generate daily income\n\nMost users recover cost in 2-3 days.\n\nWant me to set this up for you?`;
        }

        if (text.includes("yes") || text.includes("interested")) {
            return `Perfect 🔥\n\nI'll help you set everything step-by-step.\n\nYou'll start getting clients fast — this is not theory.\n\nReady to start today?`;
        }

        // AI closer fallback
        try {
            const response = await axios.post(
                "https://api.groq.com/openai/v1/chat/completions",
                {
                    model: "mixtral-8x7b-32768",
                    messages: [
                        {
                            role: "system",
                            content: "You are a high-converting sales closer. Style: human tone, short replies, ask questions, build urgency, move toward payment. Goal: convert the user into a paying customer."
                        },
                        ...context,
                        { role: "user", content: userMessage }
                    ]
                },
                { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } }
            );

            let aiReply = response.data.choices[0].message.content;

            if (score >= 5) {
                aiReply += `\n\n🔥 You're a good fit for this.\nWant me to help you start today?`;
            }

            return aiReply;

        } catch (err) {
            console.error("❌ AI error:", err.message);
            return `Hey 👋\n\nAre you looking to get clients or automate your business?`;
        }
    }
}

module.exports = { SalesAgent };
