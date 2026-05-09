/**
 * Voice Cloning Agent — TTS configuration + optional API execution.
 *
 * Priority order:
 *   1. ElevenLabs  (ELEVENLABS_API_KEY set)  → real audio URL returned
 *   2. OpenAI TTS  (OPENAI_API_KEY set)      → real audio returned
 *   3. Template mode                         → config brief returned (no key needed)
 */

const axios = require("axios");
const fs    = require("fs");
const path  = require("path");

const AUDIO_DIR = path.join(__dirname, "../../data/audio");

// ── ElevenLabs voice presets ──────────────────────────────────────
const ELEVENLABS_VOICES = {
    male_professional: { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel",  description: "Calm, professional male" },
    female_warm:       { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi",    description: "Warm, conversational female" },
    male_energetic:    { id: "ErXwobaYiN019PkySvjV", name: "Antoni",  description: "Energetic, young male" },
    female_authoritative: { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", description: "Authoritative female narrator" },
    male_storyteller:  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", description: "Deep, storytelling male" }
};

// ── OpenAI TTS voices ─────────────────────────────────────────────
const OPENAI_VOICES = {
    alloy:   "Neutral, balanced",
    echo:    "Male, clear",
    fable:   "British, expressive",
    onyx:    "Deep, authoritative male",
    nova:    "Warm female",
    shimmer: "Bright, upbeat female"
};

function _buildConfig(text, voiceProfile, speed, pitch) {
    return {
        text,
        charCount:    text.length,
        estimatedDuration: `~${Math.ceil(text.split(" ").length / 150)} min`,
        voiceProfile,
        settings: {
            speed:      speed  || 1.0,
            pitch:      pitch  || 1.0,
            stability:  0.75,   // ElevenLabs
            clarity:    0.75,   // ElevenLabs
            style:      0.5     // ElevenLabs style exaggeration
        },
        elevenlabs: {
            voice:      ELEVENLABS_VOICES[voiceProfile] || ELEVENLABS_VOICES.male_professional,
            model:      "eleven_multilingual_v2",
            endpoint:   "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        },
        openai: {
            voice:    voiceProfile.includes("female") ? "nova" : "onyx",
            model:    "tts-1-hd",
            endpoint: "https://api.openai.com/v1/audio/speech"
        },
        note: "Set ELEVENLABS_API_KEY or OPENAI_API_KEY to generate real audio"
    };
}

async function _elevenLabsTTS(text, voiceProfile, speed) {
    const key   = process.env.ELEVENLABS_API_KEY;
    if (!key) throw new Error("ELEVENLABS_API_KEY not set");

    const voice = ELEVENLABS_VOICES[voiceProfile] || ELEVENLABS_VOICES.male_professional;
    const res   = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voice.id}`,
        {
            text,
            model_id: "eleven_multilingual_v2",
            voice_settings: { stability: 0.75, similarity_boost: 0.75, style: 0.5, use_speaker_boost: true }
        },
        {
            headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
            responseType: "arraybuffer",
            timeout: 60_000
        }
    );

    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    const filename = `tts_${Date.now()}.mp3`;
    const filepath = path.join(AUDIO_DIR, filename);
    fs.writeFileSync(filepath, Buffer.from(res.data));
    return { filepath, filename, via: "elevenlabs", voice: voice.name };
}

async function _openAITTS(text, voiceProfile) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY not set");

    const voiceName = voiceProfile.includes("female") ? "nova" : "onyx";
    const res = await axios.post(
        "https://api.openai.com/v1/audio/speech",
        { model: "tts-1-hd", input: text, voice: voiceName, speed: 1.0 },
        { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, responseType: "arraybuffer", timeout: 60_000 }
    );

    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    const filename = `tts_${Date.now()}.mp3`;
    const filepath = path.join(AUDIO_DIR, filename);
    fs.writeFileSync(filepath, Buffer.from(res.data));
    return { filepath, filename, via: "openai-tts", voice: voiceName };
}

/**
 * Generate TTS audio or return config if no API key is set.
 * @param {string} text         The text to synthesize
 * @param {string} voiceProfile male_professional | female_warm | male_energetic | female_authoritative
 * @param {number} speed        0.5–2.0 (default 1.0)
 * @param {number} pitch        0.5–2.0 (default 1.0, only where supported)
 */
async function synthesize({ text, voiceProfile = "male_professional", speed = 1.0, pitch = 1.0 }) {
    if (!text) throw new Error("text required");
    if (text.length > 5000) throw new Error("text too long (max 5000 chars per request)");

    const config = _buildConfig(text, voiceProfile, speed, pitch);

    // Try ElevenLabs first, then OpenAI, then template
    if (process.env.ELEVENLABS_API_KEY) {
        try {
            const audio = await _elevenLabsTTS(text, voiceProfile, speed);
            return { ...config, generated: true, ...audio };
        } catch (err) {
            config.elevenlabsError = err.message;
        }
    }

    if (process.env.OPENAI_API_KEY) {
        try {
            const audio = await _openAITTS(text, voiceProfile);
            return { ...config, generated: true, ...audio };
        } catch (err) {
            config.openaiError = err.message;
        }
    }

    return { ...config, generated: false };
}

/** List available voice profiles. */
function listVoices() {
    return {
        profiles:    Object.entries(ELEVENLABS_VOICES).map(([id, v]) => ({ id, name: v.name, description: v.description })),
        openaiVoices: Object.entries(OPENAI_VOICES).map(([id, desc]) => ({ id, description: desc }))
    };
}

async function run(task) {
    const p            = task.payload || {};
    const text         = p.text         || task.input || "";
    const voiceProfile = p.voiceProfile || p.voice    || "male_professional";
    const speed        = p.speed        || 1.0;
    const pitch        = p.pitch        || 1.0;

    if (task.type === "list_voices") {
        return { success: true, type: "content", agent: "voiceCloningAgent", data: listVoices() };
    }

    if (!text) return { success: false, type: "content", agent: "voiceCloningAgent", data: { error: "text required" } };

    try {
        const data = await synthesize({ text, voiceProfile, speed, pitch });
        return { success: true, type: "content", agent: "voiceCloningAgent", data };
    } catch (err) {
        return { success: false, type: "content", agent: "voiceCloningAgent", data: { error: err.message } };
    }
}

module.exports = { synthesize, listVoices, run };
