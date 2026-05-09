/**
 * Voice Input — converts audio to text.
 * Stub: integrate Whisper API or AssemblyAI in production.
 */

async function transcribe(audioBuffer) {
    // Production: send audioBuffer to OpenAI Whisper or AssemblyAI
    // const FormData = require("form-data");
    // const fd = new FormData();
    // fd.append("file", audioBuffer, "audio.webm");
    // fd.append("model", "whisper-1");
    // const res = await axios.post("https://api.openai.com/v1/audio/transcriptions", fd, {...})
    console.log("🎤 VoiceInput stub — wire Whisper API for production");
    return { text: "", confidence: 0, stub: true };
}

async function processBase64(base64Audio) {
    if (!base64Audio) return { text: null, stub: true };
    const buffer = Buffer.from(base64Audio, "base64");
    return transcribe(buffer);
}

module.exports = { transcribe, processBase64 };
