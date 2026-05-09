const fs = require("fs");

class CRM {
    constructor() {
        this.file = "crm.json";
        if (!fs.existsSync(this.file)) {
            fs.writeFileSync(this.file, "[]");
        }
    }

    saveLead(lead) {
        const data = JSON.parse(fs.readFileSync(this.file));
        data.push({
            ...lead,
            status: "new",
            time: new Date()
        });
        fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
    }

    updateStatus(phone, status) {
        const data = JSON.parse(fs.readFileSync(this.file));

        const updated = data.map(l =>
            l.phone === phone ? { ...l, status } : l
        );

        fs.writeFileSync(this.file, JSON.stringify(updated, null, 2));
    }

    getLeads() {
        return JSON.parse(fs.readFileSync(this.file));
    }
}

module.exports = { CRM };