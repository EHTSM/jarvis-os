class SalesBrain {
    generatePitch(lead) {
        const name = lead.name || "there";

        return `Hi ${name},

I noticed your business and saw a big opportunity 🚀  

We help businesses like yours:
✔️ Get more leads automatically  
✔️ Close clients using AI  
✔️ Save hours daily  

We recently helped similar businesses increase revenue by 2-3x.

Want a quick demo? No pressure.`;
    }

    generateClosing(paymentLink) {
        return `Awesome — let’s get started 🚀  

Here’s the link to begin:
${paymentLink}

Once done, we’ll activate your system within 24 hours.`;
    }
}

module.exports = { SalesBrain };