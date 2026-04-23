const axios = require("axios");
const cheerio = require("cheerio");

async function extractContact(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    const text = $("body").text();

    const phone = text.match(/\+?\d[\d\s-]{8,}/g);
    const email = text.match(/\S+@\S+\.\S+/g);

    return {
      phone: phone ? phone[0] : null,
      email: email ? email[0] : null
    };

  } catch {
    return {};
  }
}

module.exports = extractContact;