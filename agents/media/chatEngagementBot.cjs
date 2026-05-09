"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "chatEngagementBot";

const POLL_TEMPLATES = {
    favorite:   (topic) => ({ question: `What's your favorite ${topic}?`, type: "single_choice" }),
    rating:     (topic) => ({ question: `Rate this ${topic} (1-5)`, type: "scale", min: 1, max: 5 }),
    yesno:      (topic) => ({ question: `Did you enjoy the ${topic}?`, type: "yes_no" }),
    prediction: (topic) => ({ question: `What do you predict will happen with ${topic}?`, type: "single_choice" })
};

const AUTO_RESPONSES = {
    hello:   ["Welcome! Glad you're here!", "Hey there! 👋", "Welcome to the stream!"],
    good:    ["Awesome! Thanks for watching!", "Love the positive energy!", "You rock!"],
    bad:     ["Thanks for the feedback, we'll improve!", "Sorry to hear that, we're working on it!"],
    question:["Great question! The streamer will answer shortly.", "Check the description for more info!"],
    first:   ["Welcome first-timer! Hope you enjoy the stream!", "First time? Stick around, it gets better!"]
};

function createPoll({ userId, streamId, topic, pollType = "favorite", options = [], duration = 60 }) {
    if (!userId || !streamId) return fail(AGENT, "userId and streamId required");
    trackEvent("poll_create", { userId, streamId });

    const template = POLL_TEMPLATES[pollType]?.(topic || "content") || POLL_TEMPLATES.favorite(topic || "content");
    const poll = {
        id:        uid("poll"),
        streamId,
        question:  template.question,
        type:      template.type,
        options:   options.length ? options : ["Option A", "Option B", "Option C"],
        votes:     {},
        duration,
        expiresAt: new Date(Date.now() + duration * 1000).toISOString(),
        createdAt: NOW()
    };

    const polls = load(userId, `stream_${streamId}_polls`, []);
    polls.push(poll);
    flush(userId, `stream_${streamId}_polls`, polls.slice(-50));

    return ok(AGENT, { poll, shareText: `📊 POLL: ${poll.question}\n${poll.options.map((o,i) => `${i+1}. ${o}`).join("\n")}\nVote with !vote 1/2/3` });
}

function submitVote({ userId, streamId, pollId, choice, voterUserId }) {
    if (!userId || !streamId || !pollId) return fail(AGENT, "userId, streamId, pollId required");
    const polls = load(userId, `stream_${streamId}_polls`, []);
    const poll  = polls.find(p => p.id === pollId);
    if (!poll)  return fail(AGENT, "Poll not found");
    if (new Date() > new Date(poll.expiresAt)) return fail(AGENT, "Poll has expired");

    poll.votes[voterUserId || uid("v")] = choice;
    flush(userId, `stream_${streamId}_polls`, polls);

    const results = {};
    for (const v of Object.values(poll.votes)) results[v] = (results[v] || 0) + 1;
    const total   = Object.values(results).reduce((a, b) => a + b, 0);

    return ok(AGENT, { pollId, results, total, leading: Object.entries(results).sort((a,b) => b[1]-a[1])[0] });
}

function triggerGiveaway({ userId, streamId, prize, keyword = "!enter", duration = 120 }) {
    if (!userId || !streamId || !prize) return fail(AGENT, "userId, streamId, prize required");
    trackEvent("giveaway_create", { userId, streamId });

    const giveaway = {
        id:        uid("gw"),
        streamId,
        prize,
        keyword,
        entries:   [],
        duration,
        expiresAt: new Date(Date.now() + duration * 1000).toISOString(),
        createdAt: NOW()
    };

    const giveaways = load(userId, `stream_${streamId}_giveaways`, []);
    giveaways.push(giveaway);
    flush(userId, `stream_${streamId}_giveaways`, giveaways.slice(-20));

    return ok(AGENT, {
        giveaway,
        announcement: `🎉 GIVEAWAY! Type "${keyword}" to enter!\nPrize: ${prize}\nEnds in ${duration} seconds!`
    });
}

function pickWinner({ userId, streamId, giveawayId }) {
    if (!userId || !streamId || !giveawayId) return fail(AGENT, "userId, streamId, giveawayId required");
    const giveaways = load(userId, `stream_${streamId}_giveaways`, []);
    const giveaway  = giveaways.find(g => g.id === giveawayId);
    if (!giveaway || !giveaway.entries.length) return fail(AGENT, "No entries or giveaway not found");

    const winner = giveaway.entries[Math.floor(Math.random() * giveaway.entries.length)];
    giveaway.winner = winner;
    flush(userId, `stream_${streamId}_giveaways`, giveaways);

    return ok(AGENT, { winner, prize: giveaway.prize, announcement: `🏆 Congratulations @${winner}! You won: ${giveaway.prize}!` });
}

function autoReply({ userId, streamId, message, authorName }) {
    if (!userId || !message) return fail(AGENT, "userId and message required");
    const lower  = message.toLowerCase();
    let response = null;
    if (/\b(hi|hello|hey|hola)\b/.test(lower))   response = AUTO_RESPONSES.hello;
    else if (/\b(great|love|amazing|awesome)\b/.test(lower)) response = AUTO_RESPONSES.good;
    else if (/\?/.test(lower))                    response = AUTO_RESPONSES.question;
    else if (/\b(first time|new here)\b/.test(lower)) response = AUTO_RESPONSES.first;

    if (!response) return ok(AGENT, { replied: false });
    const text = response[Math.floor(Math.random() * response.length)];
    return ok(AGENT, { replied: true, response: authorName ? `@${authorName} ${text}` : text });
}

module.exports = { createPoll, submitVote, triggerGiveaway, pickWinner, autoReply };
