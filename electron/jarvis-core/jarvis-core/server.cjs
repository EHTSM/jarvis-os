require("dotenv").config();
const express = require("express");
const fs = require("fs");

const app = express();
app.use(express.json());

// log
function log(message) {
  const data = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync("logs.txt", data);
}

// health
app.get("/health", (req, res) => {
  log("Health checked");
  res.json({ status: "ok", time: new Date() });
});

// add lead
app.post("/lead", (req, res) => {
  const lead = {
    ...req.body,
    time: new Date()
  };

  fs.appendFileSync("crm.json", JSON.stringify(lead) + "\n");
  log("New lead added");

  res.json({ success: true });
});

// get leads
app.get("/leads", (req, res) => {
  try {
    const data = fs.readFileSync("crm.json", "utf-8")
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);

    res.json(data);
  } catch {
    res.json([]);
  }
});

// jarvis command
app.post("/jarvis", (req, res) => {
  const command = req.body?.command;

  if (!command) {
    return res.json({ error: "No command" });
  }

  log("Command: " + command);

  let reply = "";

  if (command.includes("yes")) {
    reply = "Awesome! Pay here: https://rzp.io/l/demo";
  } else {
    reply = "Ok 👍";
  }

  res.json({ reply });
});

// auto mode
setInterval(() => {
  log("Jarvis running...");
}, 60000);

app.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
});
