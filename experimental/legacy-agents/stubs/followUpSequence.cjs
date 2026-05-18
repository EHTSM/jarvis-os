const { sendWhatsApp } = require("../utils/whatsapp.cjs");

async function followUpSequence(phone, name = "User") {

    setTimeout(() => {
        sendWhatsApp(phone, `Hey ${name}, just checking — still interested? 👀`);
    }, 6 * 60 * 60 * 1000); // 6 hrs

    setTimeout(() => {
        sendWhatsApp(phone, `Quick update 🚀 people are already getting results from this system.`);
    }, 24 * 60 * 60 * 1000); // 1 day

    setTimeout(() => {
        sendWhatsApp(phone, `Last call ⚠️ I can only onboard limited users.\nWant me to reserve your spot?`);
    }, 48 * 60 * 60 * 1000); // 2 day
}

module.exports = { followUpSequence };