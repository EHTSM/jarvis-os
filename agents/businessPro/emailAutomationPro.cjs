/**
 * Email Automation Pro — manages email sequences (welcome, nurture, win-back).
 * Stores sequences and send log in data/businesspro/email-*.json.
 * Uses nodemailer if EMAIL_* env vars set; otherwise logs for external ESP.
 */

const { load, flush, uid, MAX_BATCH, MAX_RETRY, NOW } = require("./_store.cjs");
const { getLeads, updateLead }                        = require("../crm.cjs");

const SEQ_STORE  = "email-sequences";
const LOG_STORE  = "email-log";

// Built-in sequences
const BUILT_IN_SEQUENCES = {
    welcome: {
        name: "Welcome Sequence",
        emails: [
            { day: 0, subject: "Welcome to Jarvis OS! Here's how to start 🚀",    body: "Hi {name},\n\nWelcome! You just made a great decision.\n\nYour first step: [onboarding action].\n\nReply if you need help.\n\nBest,\nJarvis Team" },
            { day: 2, subject: "Are you getting results yet?",                     body: "Hi {name},\n\nJust checking in — have you tried [feature] yet?\n\nMost users love it because [benefit].\n\nHere's a quick tip: [tip]\n\nLet me know how it's going!" },
            { day: 5, subject: "The #1 thing our top users do differently",        body: "Hi {name},\n\nI've noticed something about users who get results fast.\n\nThey always [key action].\n\nHere's how to do it in 5 minutes: [steps]\n\nTry it today." },
            { day: 10, subject: "Your 10-day check-in — how are things going?",   body: "Hi {name},\n\nYou've been with us 10 days! 🎉\n\nIf you're getting results: great! Reply and tell me.\n\nIf not: what's blocking you? Reply and we'll sort it out together." }
        ]
    },
    nurture: {
        name: "Lead Nurture Sequence",
        emails: [
            { day: 0, subject: "Free resource: [Lead Magnet Title]",               body: "Hi {name},\n\nHere's the [resource] you requested: [link]\n\nKey takeaways:\n• [Takeaway 1]\n• [Takeaway 2]\n• [Takeaway 3]\n\nBest," },
            { day: 3, subject: "How [company] went from 0 to ₹50k using Jarvis",  body: "Hi {name},\n\n[Customer name] was exactly where you are 3 months ago.\n\nHere's their story: [story]\n\nResult: [result in numbers].\n\nWant the same? Reply YES." },
            { day: 7, subject: "You're leaving money on the table (here's how)",  body: "Hi {name},\n\nEvery day without automation costs you:\n• [cost 1]\n• [cost 2]\n• [cost 3]\n\nHere's how to fix it fast: [solution link]\n\nDon't leave it another week." }
        ]
    },
    winback: {
        name: "Win-Back Sequence",
        emails: [
            { day: 0, subject: "We miss you {name} — here's something special",  body: "Hi {name},\n\nIt's been a while! We've added a ton since you left:\n• [New feature 1]\n• [New feature 2]\n• [New feature 3]\n\nCome back for 30% off your first month. Use code: COMEBACK\n\nOffer expires in 48 hours." },
            { day: 3, subject: "Last chance — 30% off expires today",            body: "Hi {name},\n\nThis is the last reminder for your 30% discount.\n\nCode: COMEBACK — expires at midnight.\n\n[CTA Button Link]\n\nHope to see you back!" }
        ]
    }
};

function _seqs()         { return load(SEQ_STORE, []); }
function _log()          { return load(LOG_STORE, []); }
function _saveSeqs(d)    { flush(SEQ_STORE, d); }
function _saveLog(d)     { flush(LOG_STORE, d); }

function _personalize(text, lead) {
    return text.replace(/{name}/g, lead.name || "there").replace(/{email}/g, lead.email || "");
}

/**
 * Enroll a lead in a built-in or custom sequence.
 */
function enroll(phone, sequenceKey = "welcome") {
    const leads = getLeads();
    const lead  = leads.find(l => l.phone === phone);
    if (!lead) throw new Error("Lead not found in CRM");
    if (!lead.email) return { warning: "No email for this lead. Add email to CRM entry.", phone };

    const seq    = BUILT_IN_SEQUENCES[sequenceKey];
    if (!seq)    throw new Error(`Sequence "${sequenceKey}" not found. Available: ${Object.keys(BUILT_IN_SEQUENCES).join(", ")}`);

    updateLead(phone, { emailSequence: sequenceKey, emailEnrolledAt: NOW(), emailStep: 0 });
    return { enrolled: true, phone, name: lead.name, sequence: seq.name, steps: seq.emails.length };
}

/**
 * Get emails that are due to send across all enrolled leads.
 */
function getDueEmails() {
    const leads = getLeads().filter(l => l.emailSequence && l.emailEnrolledAt && l.email);
    const due   = [];

    for (const lead of leads) {
        const seq  = BUILT_IN_SEQUENCES[lead.emailSequence];
        if (!seq) continue;
        const step    = lead.emailStep || 0;
        const email   = seq.emails[step];
        if (!email) continue;
        const dueTime = new Date(lead.emailEnrolledAt).getTime() + email.day * 86_400_000;
        if (Date.now() >= dueTime) {
            due.push({ lead, email, step, sequenceKey: lead.emailSequence });
        }
    }

    return due;
}

/**
 * Process and send all due emails (batch-limited).
 */
async function processDue(dryRun = false) {
    const due    = getDueEmails().slice(0, MAX_BATCH);
    const results = [];
    const log    = _log();

    for (const { lead, email, step, sequenceKey } of due) {
        const subject = _personalize(email.subject, lead);
        const body    = _personalize(email.body, lead);

        let sent = false;
        if (!dryRun) {
            // Try nodemailer if configured
            try {
                const nodemailer = require("nodemailer");
                const transport  = nodemailer.createTransport({
                    host: process.env.EMAIL_HOST, port: parseInt(process.env.EMAIL_PORT || "587"),
                    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
                });
                await transport.sendMail({ from: process.env.EMAIL_FROM || process.env.EMAIL_USER, to: lead.email, subject, text: body });
                sent = true;
            } catch {
                // Log as queued for external ESP (Mailchimp, SendGrid, etc.)
                sent = false;
            }
        }

        // Always advance the step
        updateLead(lead.phone, { emailStep: step + 1, lastEmailSentAt: NOW() });
        log.push({ id: uid("email"), phone: lead.phone, email: lead.email, subject, step, sent, dryRun, sentAt: NOW() });
        results.push({ phone: lead.phone, email: lead.email, subject, sent, dryRun });
    }

    if (log.length > 500) log.splice(0, log.length - 500);
    _saveLog(log);

    return { processed: results.length, sent: results.filter(r => r.sent).length, queued: results.filter(r => !r.sent).length, results };
}

async function run(task) {
    const p   = task.payload || {};
    try {
        let data;
        switch (task.type) {
            case "email_enroll":    data = enroll(p.phone, p.sequence || "welcome"); break;
            case "email_due":       data = { due: getDueEmails() }; break;
            case "email_process":   data = await processDue(p.dryRun || false); break;
            case "email_log":       data = { log: _log().slice(-50) }; break;
            default:                data = { sequences: Object.keys(BUILT_IN_SEQUENCES), pending: getDueEmails().length };
        }
        return { success: true, type: "business_pro", agent: "emailAutomationPro", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "emailAutomationPro", data: { error: err.message } };
    }
}

module.exports = { enroll, getDueEmails, processDue, run };
