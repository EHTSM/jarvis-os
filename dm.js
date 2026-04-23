const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function sendDM(phone) {
  console.log("📩 DM sent to:", phone);

  // future: Instagram / Telegram connect
}

module.exports = { sendDM };