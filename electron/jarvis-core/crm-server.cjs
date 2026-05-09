const express = require("express");
const fs = require("fs");

const app = express();
const PORT = 4000;

// 🧠 SAFE READ FUNCTION (crash avoid)
function getCRMData() {
  try {
    if (!fs.existsSync("core/crm.json")) {
      return [];
    }

    const raw = fs.readFileSync("core/crm.json", "utf-8");

    if (!raw.trim()) return [];

    return raw
      .split("\n")
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

  } catch (err) {
    console.error("❌ CRM READ ERROR:", err.message);
    return [];
  }
}

// 📊 GET ALL LEADS
app.get("/crm", (req, res) => {
  const data = getCRMData();
  res.json({
    total: data.length,
    data
  });
});

// 🔍 FILTER (optional powerful)
app.get("/crm/status/:status", (req, res) => {
  const data = getCRMData();
  const filtered = data.filter(item => item.status === req.params.status);

  res.json({
    total: filtered.length,
    data: filtered
  });
});

// 🚀 START SERVER
app.listen(PORT, () => {
  console.log(`🚀 CRM running on http://localhost:${PORT}/crm`);
});