/**
 * Payment Agent — wraps existing utils/payment.cjs Razorpay integration.
 * DO NOT duplicate payment logic — delegates entirely to the existing util.
 */

const { createPaymentLink: _createLink } = require("../../utils/payment.cjs");

const CURRENCY = "INR";

async function createPayment({ amount, name = "Customer", description = "Jarvis Payment", email, phone }) {
    if (!amount || isNaN(amount) || amount <= 0) {
        return { success: false, error: "Valid positive amount is required" };
    }

    try {
        const link = await _createLink({ amount, name, description });

        if (!link) {
            return { success: false, error: "Payment link creation failed — check RAZORPAY_KEY/SECRET" };
        }

        return {
            success:     true,
            link,
            amount,
            currency:    CURRENCY,
            description,
            customer:    { name, email: email || null, phone: phone || null },
            createdAt:   new Date().toISOString()
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function getPaymentStatus(paymentId) {
    if (!paymentId) return { success: false, error: "paymentId is required" };

    try {
        const Razorpay = require("razorpay");
        const instance = new Razorpay({
            key_id:     process.env.RAZORPAY_KEY,
            key_secret: process.env.RAZORPAY_SECRET
        });
        const payment = await instance.payments.fetch(paymentId);
        return {
            success: true,
            paymentId,
            status:  payment.status,
            amount:  payment.amount / 100,
            currency: payment.currency,
            method:  payment.method
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { createPayment, getPaymentStatus };
