require("dotenv").config();

const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const fetch = require("node-fetch");
const OpenAI = require("openai");
const Razorpay = require("razorpay");

const app = express();
app.use(express.json({ verify: (req, res, buf) => (req.rawBody = buf) }));

// ====== CONFIG ======
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY,
  key_secret: process.env.RAZORPAY_SECRET,
});

// ====== UTIL ======
function log(msg) {
  fs.appendFileSync("logs.txt", `[${new Date().toISOString()}] ${msg}\n`);
}

// ===== WHATSAPP SEND FUNCTION =====
async function waSend(phone, text) {
  console.log("📤 SENDING:", phone, text);

  const response = await fetch(
    `https://graph.facebook.com/v19.0/${process.env.WA_PHONE_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WA_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: { body: text }
      })
    }
  );

  const data = await response.json();
  console.log("📤 RESPONSE:", data);
}
// ====== AI ======
const SYSTEM_PROMPT = `
You are a sales closer.
Goal: sell ₹500 product.
Reply short. Create urgency.
End with: Start now
`;

async function aiReply(message) {
  const res = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: message },
    ],
  });
  return res.choices[0].message.content;
}

// ====== HEALTH ======
app.get("/", (req, res) => res.send("Jarvis Running ✅"));
app.get("/health", (req, res) => res.json({ ok: true }));

// ====== WHATSAPP WEBHOOK (VERIFY) ======

app.get("/whatsapp/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("VERIFY HIT:", mode, token);

  if (mode === "subscribe" && token === "jarvis_verify") {
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// ====== WHATSAPP INCOMING ======

app.post("/whatsapp/webhook", async (req, res) => {
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;

    // 📨 Incoming message
    if (value?.messages) {
      const msg = value.messages[0];
      const phone = msg.from;
      const text = msg.text?.body || "";

      console.log("📩 MESSAGE:", phone, text);

      // 1) AI reply
      const reply = await aiReply(text);
      await waSend(phone, reply);

      // 2) Interest → payment
      if (/start|yes|price|earn/i.test(text.toLowerCase())) {
        const link = await razorpay.paymentLink.create({
          amount: 500 * 100,
          currency: "INR",
          description: "Jarvis System",
          customer: { contact: phone }
        });

        await waSend(phone, `🚀 Start now:\n${link.short_url}`);

        // 3) follow-up
        setTimeout(() => waSend(phone, "⚡ Offer ending soon"), 10 * 60 * 1000);
        setTimeout(() => waSend(phone, "🔥 Last chance today"), 60 * 60 * 1000);
      }
    }

    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

// ====== RAZORPAY WEBHOOK ======
app.post(
  "/razorpay/webhook",
  express.json({
    verify: (req, res, buf) => (req.rawBody = buf),
  }),
  (req, res) => {
    try {
      const secret = "jarvis_secret_123";
      const signature = req.headers["x-razorpay-signature"];

      const expected = crypto
        .createHmac("sha256", secret)
        .update(req.rawBody)
        .digest("hex");

      if (signature === expected) {
        const event = req.body;
        if (event.event === "payment.captured") {
          const payment = event.payload.payment.entity;
          const phone = payment.contact || "NA";

          log(`PAID ${phone}`);

          waSend(phone, "✅ Payment received. Service started 🚀");
        }
        return res.sendStatus(200);
      }
      res.sendStatus(400);
    } catch (e) {
      console.error(e);
      res.sendStatus(500);
    }
  }
);

// ====== AUTO LEAD SENDER (SAFE LIMIT) ======
const leads = [
  "919582010431",
  // add real opted-in numbers
];

setInterval(async () => {
  for (const num of leads) {
    await waSend(num, "🔥 Earn ₹500–₹2000/day\nReply START");
  }
}, 3 * 60 * 60 * 1000); // हर 3 घंटे

// ====== START ======
app.listen(process.env.PORT, () =>
  console.log("🚀 Server running on " + process.env.PORT)
);