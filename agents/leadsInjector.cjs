const fs = require("fs");

class LeadsInjector {
    addLead(name, phone) {
        const lead = {
            name,
            phone,
            time: new Date()
        };

        fs.appendFileSync("leads.json", JSON.stringify(lead) + "\n");
    }
}

module.exports = { LeadsInjector };