require("dotenv").config();

const express = require("express");
const fs = require("fs");
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const OpenAI = require("openai");
const Razorpay = require("razorpay");
const { analyze, decision, campaign } = require("./agents");

const app = express();
app.use(express.json());
app.use(express.static("."));
// 🔥 AI
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1"
});

// 🔥 Payment
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY,
  key_secret: process.env.RAZORPAY_SECRET
});

// 🔥 Messages
const messages = [
  "🔥 Earn ₹500/day\nReply START",
  "🚀 AI earning system\nReply START",
  "💰 Work from phone\nReply START"
];

function randomMsg() {
  return messages[Math.floor(Math.random() * messages.length)];
}

// 🔥 Load Leads
function loadLeads() {
  try {
    return JSON.parse(fs.readFileSync("memory.json", "utf-8"));
  } catch {
    return [];
  }
}

// 🔥 Save Lead
function saveLead(phone) {
  let data = loadLeads();

  if (!data.includes(phone)) {
    data.push(phone);
    fs.writeFileSync("memory.json", JSON.stringify(data, null, 2));
  }
}

// 🔥 WhatsApp Send
async function waSend(phone, text) {
  console.log("📤", phone, text);

  await fetch(`https://graph.facebook.com/v19.0/${process.env.WA_PHONE_ID}/messages`, {
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
  });
}

// 🔥 AI Reply
async function aiReply(msg) {
  const res = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [
      {
        role: "system",
        content: "You are a sales closer. Sell ₹500 system."
      },
      { role: "user", content: msg }
    ]
  });

  return res.choices[0].message.content;
}

// 🔥 Payment
async function sendPayment(phone) {
  const link = await razorpay.paymentLink.create({
    amount: 500 * 100,
    currency: "INR",
    description: "Jarvis System",
    customer: { contact: phone }
  });

  await waSend(phone, `🚀 Pay here:\n${link.short_url}`);
}

// 🔥 Webhook Verify
app.get("/whatsapp", (req, res) => {
  if (req.query["hub.verify_token"] === "jarvis_verify") {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

// 🔥 MAIN ENGINE
app.post("/whatsapp", async (req, res) => {
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;

    if (value?.messages) {
      const msg = value.messages[0];
      const phone = msg.from;
      const text = msg.text?.body || "";

      saveLead(phone);

      const reply = await aiReply(text);
      await waSend(phone, reply);

      await waSend(phone, "📈 लोग ₹500–₹2000 earn कर रहे हैं");
      await waSend(phone, "⚠️ Limited slots");

      if (/start|yes/i.test(text.toLowerCase())) {
        await sendPayment(phone);

        setTimeout(() => waSend(phone, "Still interested?"), 2 * 60 * 1000);
        setTimeout(() => waSend(phone, "⚡ Offer ending soon"), 5 * 60 * 1000);
      }
    }

    res.sendStatus(200);

  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// 🔥 Lead API
app.post("/lead", async (req, res) => {
  const { phone } = req.body;

  saveLead(phone);
  await waSend(phone, randomMsg());

  res.send("Lead captured");
});

// 🔥 Stats
app.get("/stats", (req, res) => {
  res.json({ leads: loadLeads().length });
});

// 🔥 Auto Sender
setInterval(async () => {
  const leads = loadLeads();

  for (const num of leads) {
    await waSend(num, randomMsg());
  }

}, 2 * 60 * 60 * 1000);

// 🔥 Agents
setInterval(() => {
  analyze();
  decision();
  campaign();
}, 5 * 60 * 1000);


// 🔥 Server
app.listen(3000, () => {
  console.log("🚀 Running on 3000");
});