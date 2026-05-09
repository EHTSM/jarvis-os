/**
 * Text-to-Speech — converts text to audio.
 * Stub: integrate ElevenLabs or macOS `say` command in production.
 */
const { execSync } = require("child_process");

async function synthesize(text, options = {}) {
    if (!text) return { audio: null, stub: true };

    // macOS native TTS (works offline on Mac)
    if (process.platform === "darwin" && options.useSay) {
        try {
            const voice = options.voice || "Samantha";
            const rate  = options.rate  || 180;
            execSync(`say -v "${voice}" -r ${rate} "${text.replace(/"/g, "'")}"`);
            return { audio: "spoken_via_say", success: true };
        } catch (err) {
            console.error("TTS say error:", err.message);
        }
    }

    // ElevenLabs stub
    // const res = await axios.post(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, ...)
    console.log("🔊 TTS stub — wire ElevenLabs for production audio output");
    return { audio: null, stub: true };
}

module.exports = { synthesize };
