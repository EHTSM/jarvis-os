const express = require("express");
const router = express.Router();

router.get("/dashboard", (req, res) => {
    res.send("Jarvis SaaS Dashboard Running 🚀");
});

router.get("/leads", (req, res) => {
    const crm = require("../backend/services/crmService");
    res.json(crm.getLeads());
});

module.exports = router;