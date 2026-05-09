const fs = require("fs");
const fetch = require("node-fetch");

function saveCRM(data) {
  fs.appendFileSync("crm.json", JSON.stringify(data) + "\n");
}

async function execute(action, command) {

  console.log("⚡ ACTION:", action);

  if (action === "auto_close") {

    const reply = `Awesome! 🚀

Demo:
https://your-demo-link.com

Pay here:
https://rzp.io/l/demo`;

fetch("http://localhost:5678/webhook/whatsapp", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: reply })
}).catch(() => {
  console.log("WhatsApp not running");
});

    saveCRM({
      name: "client",
      status: "paid",
      amount: 1999,
      time: new Date()
    });

    return { message: reply };
  }

  if (action === "reply") {
    return { message: "Hi 👋 How can I help?" };
  }

  return { message: "No action" };
}

module.exports = execute;