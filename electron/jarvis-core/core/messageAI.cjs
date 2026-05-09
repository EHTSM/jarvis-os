const generateText = require("./ai");

async function createMessage(business) {
  return await generateText(
    `Write a WhatsApp message to ${business} owner to offer marketing services`
  );
}

module.exports = createMessage;"find leads and contact them"