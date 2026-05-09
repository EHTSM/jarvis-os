const Razorpay = require("razorpay");

let instance = null;

function getInstance() {
    if (!instance) {
        instance = new Razorpay({
            key_id: process.env.RAZORPAY_KEY,
            key_secret: process.env.RAZORPAY_SECRET
        });
    }
    return instance;
}

async function createPaymentLink({ amount, name, description }) {
    try {
        const payment = await getInstance().paymentLink.create({
            amount: amount * 100, // ₹ → paise
            currency: "INR",
            description,
            customer: {
                name
            },
            notify: {
                sms: true,
                email: false
            }
        });

        return payment.short_url;

    } catch (err) {
        console.error("❌ Payment error:", err.message);
        return null;
    }
}

module.exports = { createPaymentLink };