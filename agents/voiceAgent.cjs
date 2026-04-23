/**
 * Voice Agent - Handles voice input/output
 * Speech-to-text via Whisper API
 * Text-to-speech via macOS "say" command
 */

const { exec } = require("child_process");
const { promisify } = require("util");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const execAsync = promisify(exec);

class VoiceAgent {
    constructor() {
        this.voiceEnabled = process.platform === "darwin"; // macOS only for now
        this.whisperApiKey = process.env.OPENAI_API_KEY;
        this.voiceSettings = {
            rate: 1.0,
            voice: "Samantha", // or "Victoria", "Fred", etc.
            volume: 1.0
        };
    }

    /**
     * Speak text using macOS "say" command
     * @param {string} text - Text to speak
     * @param {object} options - Voice options {rate, voice}
     */
    async speak(text, options = {}) {
        if (!this.voiceEnabled) {
            console.log("🔊 Voice disabled (not macOS)");
            return { success: false, message: "Voice not available on this platform" };
        }

        try {
            const rate = options.rate || this.voiceSettings.rate;
            const voice = options.voice || this.voiceSettings.voice;

            // Escape special characters for shell
            const escaped = text.replace(/"/g, '\\"').replace(/\$/g, '\\$').slice(0, 500);

            // Use macOS "say" command
            const command = `say -r ${rate * 200} -v "${voice}" "${escaped}"`;

            console.log(`🔊 Speaking: "${text.slice(0, 50)}..."`);
            await execAsync(command);

            return {
                success: true,
                message: "Speech completed",
                text: text.slice(0, 100),
                duration: text.length / 50 // Rough estimate
            };
        } catch (error) {
            console.error("❌ Speech error:", error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Speech to text using OpenAI Whisper API
     * Requires audio file path
     * @param {string} audioFilePath - Path to audio file (mp3, wav, m4a, etc.)
     */
    async speechToText(audioFilePath) {
        if (!this.whisperApiKey) {
            throw new Error("OPENAI_API_KEY not set");
        }

        try {
            if (!fs.existsSync(audioFilePath)) {
                throw new Error(`Audio file not found: ${audioFilePath}`);
            }

            const audioStream = fs.createReadStream(audioFilePath);
            const formData = new FormData();
            formData.append("file", audioStream);
            formData.append("model", "whisper-1");

            console.log("🎤 Converting speech to text...");

            const response = await axios.post(
                "https://api.openai.com/v1/audio/transcriptions",
                formData,
                {
                    headers: {
                        "Authorization": `Bearer ${this.whisperApiKey}`,
                        ...formData.getHeaders()
                    }
                }
            );

            const transcribed = response.data.text;
            console.log(`📝 Transcribed: "${transcribed}"`);

            return {
                success: true,
                text: transcribed,
                confidence: response.data.confidence || 0.95
            };
        } catch (error) {
            console.error("❌ Speech-to-text error:", error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get available voices on macOS
     */
    async getAvailableVoices() {
        try {
            const { stdout } = await execAsync("say -v '?' | awk '{print $1}'");
            const voices = stdout.split('\n').filter(v => v.trim());
            return voices;
        } catch (error) {
            return ["Samantha", "Victoria", "Alex"]; // Default voices
        }
    }

    /**
     * Speak with callback for async operations
     */
    speakAsync(text, options = {}) {
        return new Promise((resolve) => {
            this.speak(text, options).then(result => {
                resolve(result);
            }).catch(error => {
                resolve({ success: false, error: error.message });
            });
        });
    }

    /**
     * Enable/disable voice
     */
    setVoiceEnabled(enabled) {
        this.voiceEnabled = enabled && process.platform === "darwin";
        console.log(`🔊 Voice ${this.voiceEnabled ? "enabled" : "disabled"}`);
    }

    /**
     * Set voice preference
     */
    setVoicePreference(voice, rate = 1.0) {
        this.voiceSettings.voice = voice;
        this.voiceSettings.rate = rate;
        console.log(`🎤 Voice set to: ${voice} (rate: ${rate})`);
    }
}

module.exports = VoiceAgent;
