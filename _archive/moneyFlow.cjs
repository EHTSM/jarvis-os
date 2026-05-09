const { RealLeadsEngine } = require("./realLeadsEngine.cjs");
const { LeadScoring } = require("./leadScoring.cjs");
const { AICloser } = require("./aiCloser.cjs");
const { FollowUpSystem } = require("./followUpSystem.cjs");
const { PaymentAgent } = require("./paymentAgent.cjs");
const { SalesBrain } = require("./salesBrain.cjs");

class MoneyFlow {
    constructor() {
        this.leadsEngine = new RealLeadsEngine();
        this.scorer = new LeadScoring();
        this.closer = new AICloser();
        this.followUp = new FollowUpSystem();
        this.payment = new PaymentAgent();
        this.sales = new SalesBrain();
    }

    async run() {
        const leads = await this.leadsEngine.getLeads();
        const hotLeads = this.scorer.filterHot(leads);

        for (const lead of hotLeads) {
            if (!lead.phone) continue;

            // 🔥 1. SEND FIRST MESSAGE
            const pitch = this.sales.generatePitch(lead);
            await this.closer.sendWhatsApp(lead.phone, pitch);

            // 🔥 2. FOLLOW-UP AUTO
            this.followUp.scheduleFollowUps(lead.phone);

            console.log("✅ Lead contacted:", lead.phone);
        }
    }

    async closeDeal(phone) {
        const paymentLink = await this.payment.createPaymentLink(999);

        const closingMsg = this.sales.generateClosing(paymentLink);

        await this.closer.sendWhatsApp(phone, closingMsg);

        console.log("💰 Payment link sent");
    }
}

module.exports = { MoneyFlow };