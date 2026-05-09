const { VoiceAgent } = require("./voiceAgent.cjs");

class VoiceSales {
    constructor() {
        this.voice = new VoiceAgent();
    }

    async pitch() {
        await this.voice.speak(
            "Hello, this is Jarvis AI. We help businesses get clients automatically. Want to see demo?"
        );
    }

    async close() {
        await this.voice.speak(
            "Let’s get started. Sending you payment link now."
        );
    }
}

module.exports = { VoiceSales };