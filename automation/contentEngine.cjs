function generateReel() {
    const hooks = [
        "₹0 se ₹10,000/day kaise kamaaye",
        "AI se earning ka secret",
        "Ye system tumhari life change kar dega",
        "Phone se paisa banana start karo",
        "Online earning real hai ya scam?"
    ];

    const hook = hooks[Math.floor(Math.random() * hooks.length)];
    const caption = `🔥 ${hook}\n\n🚀 FREE AI SYSTEM\n\n👉 DM "START"\n\n#earnmoney #ai #onlineincome #jarvis`;

    return { hook, caption };
}

module.exports = { generateReel };
