"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "audioCleaner";

const NOISE_TYPES = {
    hiss:          { cause:"Microphone self-noise",     filter:"High-shelf cut above 8kHz + noise gate", ffmpeg:"afftdn=nf=-20" },
    hum_60hz:      { cause:"US electrical interference",filter:"Notch filter at 60Hz + harmonics",       ffmpeg:"equalizer=f=60:width_type=o:width=0.5:g=-30" },
    hum_50hz:      { cause:"EU electrical interference",filter:"Notch filter at 50Hz + harmonics",       ffmpeg:"equalizer=f=50:width_type=o:width=0.5:g=-30" },
    room_reverb:   { cause:"Room echo/reflection",      filter:"De-reverb plugin (iZotope RX)",          ffmpeg:"N/A (use RX or Audacity)" },
    clipping:      { cause:"Audio overloaded at source",filter:"Declipper (iZotope RX)",                 ffmpeg:"N/A — best fixed at recording" },
    wind:          { cause:"Microphone wind blast",      filter:"Low-cut below 80Hz + de-wind",          ffmpeg:"highpass=f=80" },
    keyboard_click:{ cause:"Mechanical keyboard noise",  filter:"Gate + transient removal",              ffmpeg:"N/A — use gate" },
    background_music:{ cause:"Ambient music bleed",     filter:"Vocal isolation stem separator",         ffmpeg:"N/A — use Demucs/Spleeter" }
};

const AUDIO_TARGETS = {
    voice_podcast:  { lufs:"-16", peak:"-1dBTP", eq:"boost 200-300Hz, cut 400Hz, air at 12kHz" },
    youtube:        { lufs:"-14", peak:"-1dBTP", eq:"balanced" },
    music_streaming:{ lufs:"-14", peak:"-1dBTP", eq:"mastering chain required" },
    broadcast:      { lufs:"-23", peak:"-3dBTP", eq:"EBU R128 compliance" },
    film_dialog:    { lufs:"-24", peak:"-2dBTP", eq:"cut 400Hz, boost 3kHz presence" }
};

function analyseAudio({ userId, fileId, fileName, noiseType, targetUse = "voice_podcast", measuredLufs }) {
    if (!userId) return fail(AGENT, "userId required");
    trackEvent("audio_analyse", { userId, noiseType });

    const target    = AUDIO_TARGETS[targetUse] || AUDIO_TARGETS.voice_podcast;
    const noiseInfo = noiseType ? NOISE_TYPES[noiseType.toLowerCase().replace(/\s+/g,"_")] : null;
    const lufsGap   = measuredLufs ? parseFloat(target.lufs) - parseFloat(measuredLufs) : null;

    const cleaningPlan = {
        id:          uid("ac"),
        userId,
        fileId,
        fileName,
        noiseType:   noiseType || "unspecified",
        noiseInfo,
        targetUse,
        targetSpec:  target,
        measuredLufs,
        lufsAdjustmentNeeded: lufsGap !== null ? `${lufsGap > 0 ? "+" : ""}${lufsGap.toFixed(1)} dB` : "Measure with auLoudness or ffmpeg",
        steps: [
            noiseInfo ? { step:1, action:"Noise reduction", ffmpeg: noiseInfo.ffmpeg, tool: noiseInfo.filter } : { step:1, action:"Identify and reduce background noise", tool:"iZotope RX / Audacity Noise Reduction" },
            { step:2, action:`EQ: ${target.eq}`,            tool:"EQ plugin / ffmpeg equalizer" },
            { step:3, action:"Dynamic compression",         ffmpeg:"acompressor=threshold=-20dB:ratio=3:attack=20:release=250" },
            { step:4, action:`Loudness normalise to ${target.lufs} LUFS`, ffmpeg:`loudnorm=I=${target.lufs}:LRA=11:TP=${target.peak}` },
            { step:5, action:"True-peak limit check",       tool:"Limiter at -1dBTP" }
        ],
        tools:       ["iZotope RX (best)","Audacity (free)","Adobe Audition","ffmpeg (CLI)","Krisp (realtime)"],
        createdAt:   NOW()
    };

    const log = load(userId, "audio_cleaning", []);
    log.push(cleaningPlan);
    flush(userId, "audio_cleaning", log.slice(-200));

    return ok(AGENT, { cleaningPlan });
}

function getNoiseTypes()   { return ok(AGENT, NOISE_TYPES); }
function getAudioTargets() { return ok(AGENT, AUDIO_TARGETS); }

module.exports = { analyseAudio, getNoiseTypes, getAudioTargets };
