const fs = require("fs");

// 👉 manually exported / collected leads डालो (safe तरीका)
const leads = [
  { name: "Gym Delhi", phone: "919582010431" },
  { name: "Salon Mumbai", phone: "919999999999" }
];

function saveLeads() {
  let data = [];

  try {
    data = JSON.parse(fs.readFileSync("memory.json", "utf-8"));
  } catch {
    data = [];
  }

  leads.forEach(l => {
    if (!data.includes(l.phone)) {
      data.push(l.phone);
    }
  });

  fs.writeFileSync("memory.json", JSON.stringify(data, null, 2));

  console.log("🔥 Maps leads added:", leads.length);
}

saveLeads();