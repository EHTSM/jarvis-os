"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "subtitleGenerator";

const SUPPORTED_FORMATS = {
    srt:  { ext:".srt",  desc:"SubRip — universal, supported everywhere" },
    vtt:  { ext:".vtt",  desc:"WebVTT — web/HTML5 players, YouTube" },
    ass:  { ext:".ass",  desc:"Advanced SubStation Alpha — styled subtitles" },
    sbv:  { ext:".sbv",  desc:"YouTube SBV format" },
    ttml: { ext:".ttml", desc:"Timed Text — Netflix/broadcast" },
    json: { ext:".json", desc:"JSON transcript format" }
};

const LANGUAGE_CODES = {
    english:"en", hindi:"hi", tamil:"ta", telugu:"te", bengali:"bn", marathi:"mr",
    kannada:"kn", malayalam:"ml", punjabi:"pa", gujarati:"gu", urdu:"ur",
    spanish:"es", french:"fr", german:"de", japanese:"ja", korean:"ko", arabic:"ar"
};

const STT_APIS = [
    { name:"Whisper (OpenAI)",  url:"openai.com/whisper",            free:true, wer:"~5%", languages:"99+" },
    { name:"Google Speech-to-Text", url:"cloud.google.com/speech-to-text", free:false, wer:"~7%", languages:"125+" },
    { name:"AWS Transcribe",    url:"aws.amazon.com/transcribe",     free:false, wer:"~8%", languages:"75+" },
    { name:"AssemblyAI",        url:"assemblyai.com",                free:false, wer:"~5%", languages:"25+" },
    { name:"Deepgram",          url:"deepgram.com",                  free:false, wer:"~5%", languages:"30+" }
];

function createSubtitleJob({ userId, videoId, videoTitle, language = "english", format = "srt", autoDetect = true, speakerDiarisation = false, maxCharsPerLine = 42, maxLinesPerCue = 2 }) {
    if (!userId || !videoId) return fail(AGENT, "userId and videoId required");
    trackEvent("subtitle_create", { userId, language, format });

    const langCode = LANGUAGE_CODES[language.toLowerCase()] || "en";

    const job = {
        id:           uid("sub"),
        userId,
        videoId,
        videoTitle,
        language,
        langCode,
        format,
        autoDetect,
        speakerDiarisation,
        maxCharsPerLine,
        maxLinesPerCue,
        status:       "pending",
        sttOptions:   STT_APIS,
        recommendedSTT:"Whisper (OpenAI) — best accuracy, open-source, free",
        whisperCmd:   `whisper audio.mp3 --language ${langCode} --output_format ${format} --task transcribe`,
        burnInCmd:    `ffmpeg -i video.mp4 -vf subtitles=subtitles.${format} output_with_subs.mp4`,
        exportFormats: Object.keys(SUPPORTED_FORMATS),
        createdAt:    NOW()
    };

    const jobs = load(userId, "subtitle_jobs", []);
    jobs.push(job);
    flush(userId, "subtitle_jobs", jobs.slice(-200));

    return ok(AGENT, { job });
}

function formatSubtitleBlock(text, startSec, endSec, index, format = "srt") {
    const ts = (s) => {
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60), ms = Math.round((s % 1) * 1000);
        return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
    };
    if (format === "srt") return `${index}\n${ts(startSec)} --> ${ts(endSec)}\n${text}\n\n`;
    if (format === "vtt") return `${ts(startSec).replace(",",".")} --> ${ts(endSec).replace(",",".")}\n${text}\n\n`;
    return `${index}|${startSec}|${endSec}|${text}`;
}

function getFormats()     { return ok(AGENT, SUPPORTED_FORMATS); }
function getLanguages()   { return ok(AGENT, LANGUAGE_CODES); }
function getSTTOptions()  { return ok(AGENT, STT_APIS); }

module.exports = { createSubtitleJob, formatSubtitleBlock, getFormats, getLanguages, getSTTOptions };
