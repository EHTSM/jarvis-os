const record = require("node-record-lpcm16");

function startListening(callback) {
  record.start().on("data", (data) => {
    console.log("🎤 Listening...");
    callback(data);
  });
}

module.exports = { startListening };