const axios = require("axios");

async function sendDM(username, message) {
    console.log(`📩 DM to ${username}: ${message}`);

    // ⚠️ real IG API baad me
    return true;
}

module.exports = { sendDM };