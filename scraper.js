const fs = require("fs");

// 🔥 basic lead generator (later real scraper)
const leads = [
  "919582010431",
  "919999999999"
];

function saveLeads() {
  let data = [];

  try {
    data = JSON.parse(fs.readFileSync("memory.json", "utf-8"));
  } catch {
    data = [];
  }

  leads.forEach(l => {
    if (!data.includes(l)) {
      data.push(l);
    }
  });

  fs.writeFileSync("memory.json", JSON.stringify(data, null, 2));

  console.log("🔥 Leads added:", leads.length);
}

saveLeads();