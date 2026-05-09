const Razorpay = require("razorpay");

class PaymentAgent {
    constructor() {
        this.razor = null;
    }

    _getInstance() {
        if (!this.razor) {
            this.razor = new Razorpay({
                key_id: process.env.RAZORPAY_KEY,
                key_secret: process.env.RAZORPAY_SECRET
            });
        }
        return this.razor;
    }

    async createPaymentLink(amount = 999) {
        const link = await this._getInstance().paymentLink.create({
            amount: amount * 100,
            currency: "INR",
            description: "AI Automation Service",
        });

        return link.short_url;
    }
}

module.exports = { PaymentAgent };
