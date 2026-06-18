"use strict";
/**
 * businessEventAdapter.cjs — Phase B4: External Business Integration Layer
 *
 * Normalizes external events from any source into business entities, then
 * routes them through the existing B1/B2/B3 stack.
 *
 * NO new scheduler. NO new event bus. NO duplicate automation runtime.
 *
 * Flow:
 *   External event (webhook/form/email/whatsapp/payment/calendar/manual)
 *     → normalize(source, raw)   → BusinessEvent
 *     → toEntity(event)          → { entityType, entity }
 *     → businessEntityModel.createBusinessMission()
 *     → businessIntelligenceEngine.scan() [optional]
 *     → runtimeEventBus.emit("business:event", ...)
 *     → operationsAlertingLayer.fire() [for high-priority]
 *
 * Reused systems (unchanged):
 *   runtimeEventBus.cjs          → emit() — fan-out to SSE subscribers
 *   businessEntityModel.cjs      → createBusinessMission()
 *   businessMissionAutomation.cjs→ runTemplate()
 *   businessIntelligenceEngine.cjs → scan()
 *   businessDataService.cjs      → createLead(), createOpportunity(), etc.
 *   continuousLearningEngine.cjs → createLesson()
 *   operationsAlertingLayer.cjs  → fire()
 *   missionMemory.cjs            → recordDecision()
 *
 * Public API:
 *   ingest(source, raw, opts)         → { eventId, entityType, entity, missionId }
 *   normalize(source, raw)            → BusinessEvent
 *   toEntity(event)                   → { entityType, entity } | null
 *   getEventLog(opts)                 → paginated event log
 *   getStats()                        → counts by source / entityType
 *   registerSource(source, normFn)    → register custom normalizer
 *   SOURCES                           → list of built-in source names
 */

const logger = require("../utils/logger");
const crypto = require("crypto");
const path   = require("path");
const fs     = require("fs");

// ── Lazy loaders ──────────────────────────────────────────────────────────────
function _bus()  { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }
function _bem()  { try { return require("./businessEntityModel.cjs");                } catch { return null; } }
function _bma()  { try { return require("./businessMissionAutomation.cjs");          } catch { return null; } }
function _bie()  { try { return require("./businessIntelligenceEngine.cjs");         } catch { return null; } }
function _bds()  { try { return require("./businessDataService.cjs");                } catch { return null; } }
function _le()   { try { return require("./continuousLearningEngine.cjs");           } catch { return null; } }
function _alert(){ try { return require("./operationsAlertingLayer.cjs");            } catch { return null; } }
function _mem()  { try { return require("./missionMemory.cjs");                      } catch { return null; } }

// ── Event log (ring buffer in memory + optional JSON flush) ───────────────────
const EVENT_LOG_MAX = 500;
const _eventLog = [];
let _eventSeq = 0;

const DATA_DIR  = path.join(__dirname, "../../data");
const LOG_FILE  = path.join(DATA_DIR, "biz-events.json");

const _stats = { bySource: {}, byEntityType: {}, total: 0, missions: 0, errors: 0 };

// ── Source names ──────────────────────────────────────────────────────────────
const SOURCES = {
    FORM:      "form",
    EMAIL:     "email",
    WHATSAPP:  "whatsapp",
    TELEGRAM:  "telegram",
    PAYMENT:   "payment",
    CALENDAR:  "calendar",
    WEBHOOK:   "webhook",
    MANUAL:    "manual",
};

// ── ID helper ─────────────────────────────────────────────────────────────────
function _eid() { return `bevt_${Date.now()}_${(++_eventSeq).toString(36)}`; }

// ── Persist event log entry ───────────────────────────────────────────────────
function _logEvent(ev) {
    _eventLog.push(ev);
    if (_eventLog.length > EVENT_LOG_MAX) _eventLog.shift();
    // Async flush — don't block caller
    setImmediate(() => {
        try {
            if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
            const existing = (() => {
                try { return JSON.parse(fs.readFileSync(LOG_FILE, "utf8")); } catch { return []; }
            })();
            const merged = [...existing, ev].slice(-EVENT_LOG_MAX);
            fs.writeFileSync(LOG_FILE, JSON.stringify(merged, null, 2));
        } catch {}
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILT-IN NORMALIZERS
// Each: normalize(raw) → BusinessEvent | null
// BusinessEvent: { eventId, source, type, raw, normalized: { name, email, phone,
//   company, message, value, currency, subject, body, metadata } }
// ─────────────────────────────────────────────────────────────────────────────

const _normalizers = {};

// ── Form submission ───────────────────────────────────────────────────────────
_normalizers[SOURCES.FORM] = function normalizeForm(raw) {
    const n = raw.name || raw.fullName || raw.firstName
        ? `${raw.firstName || ""} ${raw.lastName || ""}`.trim() || raw.name || raw.fullName
        : null;
    return {
        type:       "lead",
        normalized: {
            name:    n,
            email:   raw.email || raw.emailAddress || null,
            phone:   raw.phone || raw.phoneNumber || raw.mobile || null,
            company: raw.company || raw.organisation || raw.organization || null,
            message: raw.message || raw.enquiry || raw.comments || raw.body || null,
            subject: raw.subject || raw.formName || raw.formId || "Web Form",
            source:  "form",
            metadata: { url: raw.url || raw.page || null, utmSource: raw.utm_source || null, utmCampaign: raw.utm_campaign || null },
        },
    };
};

// ── Email received ────────────────────────────────────────────────────────────
_normalizers[SOURCES.EMAIL] = function normalizeEmail(raw) {
    // Support SendGrid, Mailgun, Postmark inbound schemas
    const from  = raw.from || raw.sender || raw.From || "";
    const emailMatch = from.match(/<([^>]+)>/) || [null, from];
    const email = emailMatch[1]?.trim() || from.trim();
    const name  = from.replace(/<[^>]+>/, "").trim() || null;
    return {
        type:       "lead",
        normalized: {
            name:    name || null,
            email:   email || null,
            phone:   null,
            company: null,
            message: raw.text || raw.body || raw["body-plain"] || raw.stripped_text || null,
            subject: raw.subject || raw.Subject || null,
            source:  "email",
            metadata: {
                messageId:  raw.messageId || raw["Message-Id"] || raw.MessageId || null,
                inReplyTo:  raw.inReplyTo || raw["In-Reply-To"] || null,
                timestamp:  raw.timestamp || raw.Date || null,
            },
        },
    };
};

// ── WhatsApp message ──────────────────────────────────────────────────────────
_normalizers[SOURCES.WHATSAPP] = function normalizeWhatsapp(raw) {
    // Support WhatsApp Business API (360dialog, Twilio, Meta Cloud API)
    const contact = raw.contacts?.[0] || raw.contact || {};
    const message = raw.messages?.[0] || raw.message || {};
    const profile = contact.profile || {};
    const phone   = message.from || contact.wa_id || raw.from || raw.phone || null;
    const text    = message.text?.body || message.body || raw.body || raw.text || null;
    return {
        type:       "lead",
        normalized: {
            name:    profile.name || raw.name || null,
            email:   null,
            phone:   phone ? String(phone).replace(/\D/g, "") : null,
            company: null,
            message: text,
            subject: "WhatsApp Inbound",
            source:  "whatsapp",
            metadata: {
                waId:      contact.wa_id || phone,
                messageId: message.id || raw.messageId || null,
                timestamp: message.timestamp || raw.timestamp || null,
            },
        },
    };
};

// ── Telegram message ──────────────────────────────────────────────────────────
_normalizers[SOURCES.TELEGRAM] = function normalizeTelegram(raw) {
    const msg  = raw.message || raw;
    const from = msg.from || {};
    const text = msg.text || raw.text || null;
    const name = [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || null;
    return {
        type:       "lead",
        normalized: {
            name,
            email:   null,
            phone:   null,
            company: null,
            message: text,
            subject: "Telegram Inbound",
            source:  "telegram",
            metadata: {
                chatId:    msg.chat?.id || from.id || null,
                userId:    from.id || null,
                username:  from.username || null,
                messageId: msg.message_id || null,
            },
        },
    };
};

// ── Payment received ──────────────────────────────────────────────────────────
_normalizers[SOURCES.PAYMENT] = function normalizePayment(raw) {
    // Support Razorpay, Stripe, generic payment webhooks
    const payment  = raw.payload?.payment?.entity || raw.data?.object || raw.payment || raw;
    const contact  = raw.payload?.order?.entity   || raw.data?.customer || {};
    const amount   = payment.amount
        ? (payment.amount / 100)           // Razorpay sends paise
        : (payment.amount_captured || payment.amount_total || payment.amount || 0);
    const currency = (payment.currency || "INR").toUpperCase();
    const name     = contact.name || payment.contact_name || payment.customer_name || raw.customer_name || null;
    const email    = contact.email || payment.email || payment.customer_email || raw.email || null;
    const phone    = contact.contact || payment.contact || payment.customer_phone || raw.phone || null;
    return {
        type:       "deal",
        normalized: {
            name:    name,
            email:   email,
            phone:   phone ? String(phone).replace(/\D/g, "") : null,
            company: null,
            message: null,
            subject: `Payment received — ${currency} ${amount}`,
            source:  "payment",
            value:   amount,
            currency,
            metadata: {
                paymentId:  payment.id || raw.razorpay_payment_id || null,
                orderId:    payment.order_id || contact.id || null,
                status:     payment.status || "captured",
                method:     payment.method || null,
            },
        },
    };
};

// ── Calendar event ────────────────────────────────────────────────────────────
_normalizers[SOURCES.CALENDAR] = function normalizeCalendar(raw) {
    // Support Google Calendar / Calendly / generic calendar payloads
    const event    = raw.event || raw;
    const attendee = (event.attendees || event.invitees || [])[0] || {};
    return {
        type:       "operation",
        normalized: {
            name:    event.summary || event.name || event.title || "Calendar Event",
            email:   attendee.email || null,
            phone:   null,
            company: attendee.organization || null,
            message: event.description || event.notes || null,
            subject: event.summary || event.title || "Calendar Event",
            source:  "calendar",
            metadata: {
                startTime:  event.start?.dateTime || event.start_time || null,
                endTime:    event.end?.dateTime   || event.end_time   || null,
                meetingUrl: event.hangoutLink || event.location || event.join_url || null,
                eventId:    event.id || event.uuid || null,
            },
        },
    };
};

// ── Generic REST webhook ──────────────────────────────────────────────────────
_normalizers[SOURCES.WEBHOOK] = function normalizeWebhook(raw) {
    // Best-effort extraction from any JSON payload
    const entityType = raw.entityType || raw.entity_type || raw.type || "lead";
    return {
        type: entityType,
        normalized: {
            name:    raw.name || raw.title || raw.summary || null,
            email:   raw.email || null,
            phone:   raw.phone || raw.mobile || null,
            company: raw.company || raw.organization || null,
            message: raw.message || raw.description || raw.body || null,
            subject: raw.subject || raw.event || raw.trigger || "Webhook",
            source:  "webhook",
            value:   raw.value || raw.amount || null,
            currency: raw.currency || null,
            metadata: raw.metadata || {},
        },
    };
};

// ── Manual API trigger ────────────────────────────────────────────────────────
_normalizers[SOURCES.MANUAL] = function normalizeManual(raw) {
    return {
        type: raw.entityType || raw.type || "lead",
        normalized: {
            name:    raw.name || null,
            email:   raw.email || null,
            phone:   raw.phone || null,
            company: raw.company || null,
            message: raw.message || raw.description || null,
            subject: raw.subject || "Manual Trigger",
            source:  "manual",
            value:   raw.value || null,
            currency: raw.currency || null,
            metadata: raw.metadata || {},
        },
    };
};

// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZE
// ─────────────────────────────────────────────────────────────────────────────

function normalize(source, raw) {
    const normalizer = _normalizers[source];
    if (!normalizer) throw new Error(`No normalizer for source: ${source}. Supported: ${Object.values(SOURCES).join(", ")}`);
    const result = normalizer(raw);
    if (!result) return null;
    return {
        eventId:    _eid(),
        source,
        type:       result.type,
        normalized: result.normalized,
        rawSize:    JSON.stringify(raw).length,
        normalizedAt: new Date().toISOString(),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY MAPPING
// Maps normalized event → { entityType, entity } for B1 createBusinessMission
// ─────────────────────────────────────────────────────────────────────────────

function toEntity(event) {
    const { type, normalized: n, source } = event;
    const base = {
        id:      `${source}_${event.eventId}`,
        name:    n.name,
        email:   n.email,
        phone:   n.phone,
        company: n.company,
        source,
        metadata: n.metadata || {},
    };

    switch (type) {
        case "lead":
            return {
                entityType: "lead",
                entity: {
                    ...base,
                    message: n.message,
                    subject: n.subject,
                    status:  "new",
                    score:   _autoScore(n),
                },
            };
        case "deal":
            return {
                entityType: "deal",
                entity: {
                    ...base,
                    title:    n.subject || `Deal from ${source}`,
                    value:    n.value || 0,
                    currency: n.currency || "USD",
                    stage:    "identified",
                    description: n.message,
                },
            };
        case "customer":
            return {
                entityType: "customer",
                entity: {
                    ...base,
                    status: "onboarding",
                    plan:   n.metadata?.plan || null,
                    action: "onboard",
                },
            };
        case "operation":
            return {
                entityType: "operation",
                entity: {
                    ...base,
                    title:    n.name || n.subject,
                    category: source,
                    steps:    n.metadata?.steps || [],
                },
            };
        case "marketing_task":
            return {
                entityType: "marketing_task",
                entity: {
                    ...base,
                    title:    n.subject || n.name,
                    campaign: n.metadata?.campaign || null,
                    channel:  n.metadata?.channel || source,
                },
            };
        default:
            return {
                entityType: "lead",
                entity: { ...base, status: "new", score: _autoScore(n) },
            };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-SCORE — quick lead quality estimate from normalized event
// ─────────────────────────────────────────────────────────────────────────────
function _autoScore(n) {
    let score = 0;
    if (n.name)    score += 20;
    if (n.email)   score += 25;
    if (n.phone)   score += 20;
    if (n.company) score += 15;
    if (n.source !== "manual") score += 10;
    if (n.value && n.value > 0) score += 10;
    return Math.min(score, 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// INGEST — main entry point
// ─────────────────────────────────────────────────────────────────────────────

async function ingest(source, raw, opts = {}) {
    const startedAt = new Date().toISOString();
    let event, entityResult, missionId = null, automationResult = null;

    try {
        // 1. Normalize
        event = normalize(source, raw);
        if (!event) throw new Error(`Normalizer returned null for source: ${source}`);

        // 2. Map to entity
        entityResult = toEntity(event);
        if (!entityResult) throw new Error("Entity mapping returned null");

        const { entityType, entity } = entityResult;

        // 3. Persist entity in businessDataService (best-effort)
        try {
            const bds = _bds();
            if (bds) {
                if (entityType === "lead")       bds.createLead(entity);
                else if (entityType === "deal")  bds.createOpportunity(entity);
                // contacts and operations don't auto-create here — mission is enough
            }
        } catch {}

        // 4. Create business mission via B1 entity model
        const bem = _bem();
        if (bem) {
            const mission = bem.createBusinessMission(entityType, entity, { priority: opts.priority || "high" });
            missionId = mission?.missionId || mission?.id || null;
        }

        // 5. Optionally run full automation template (B2)
        if (opts.automate && missionId) {
            try {
                const bma = _bma();
                if (bma) {
                    automationResult = await bma.runTemplate(entityType, entity, { missionId, priority: opts.priority });
                }
            } catch (e) {
                logger.warn(`[BizAdapter] Automation failed for ${event.eventId}: ${e.message}`);
            }
        }

        // 6. Emit onto runtimeEventBus — fans out to SSE subscribers
        const busPayload = {
            eventId:    event.eventId,
            source,
            entityType,
            entityId:   entity.id,
            missionId,
            normalizedAt: event.normalizedAt,
            lead:   entityType === "lead"  ? entity : undefined,
            deal:   entityType === "deal"  ? entity : undefined,
        };
        try { _bus()?.emit("business:event", busPayload); } catch {}

        // 7. Alert for high-value or critical sources
        const isHighValue = (entity.value || 0) > 5000 || source === SOURCES.PAYMENT;
        if (isHighValue || opts.alert) {
            _alert()?.fire({
                title:    `[Ingest] ${source}: ${entity.name || entity.title || entity.id}`,
                message:  `New ${entityType} ingested from ${source} — mission: ${missionId || "none"}`,
                severity: isHighValue ? "warning" : "info",
                source:   "businessEventAdapter",
            });
        }

        // 8. Record lesson
        try {
            _le()?.createLesson({
                type:          "business_event",
                title:         `[B4] Event ingested: ${source} → ${entityType}`,
                detail:        `Source: ${source}, Entity: ${entityType}, Mission: ${missionId}`,
                severity:      "info",
                sourcePattern: `${source}_ingest`,
                source:        "businessEventAdapter",
            });
        } catch {}

        // 9. Update stats
        _stats.total++;
        _stats.bySource[source] = (_stats.bySource[source] || 0) + 1;
        _stats.byEntityType[entityType] = (_stats.byEntityType[entityType] || 0) + 1;
        if (missionId) _stats.missions++;

        const record = {
            eventId:         event.eventId,
            source,
            entityType,
            entityId:        entity.id,
            missionId,
            status:          "ingested",
            startedAt,
            completedAt:     new Date().toISOString(),
            automationRan:   !!automationResult,
            automationSteps: automationResult?.steps || null,
        };
        _logEvent(record);

        logger.info(`[BizAdapter] Ingested ${source} → ${entityType} (eventId: ${event.eventId}, mission: ${missionId || "none"})`);
        return record;

    } catch (e) {
        _stats.errors++;
        const errRecord = {
            eventId:     event?.eventId || _eid(),
            source,
            entityType:  entityResult?.entityType || "unknown",
            status:      "error",
            error:        e.message,
            startedAt,
            completedAt: new Date().toISOString(),
        };
        _logEvent(errRecord);
        logger.warn(`[BizAdapter] Ingest error (${source}): ${e.message}`);
        throw e;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// INSPECTION
// ─────────────────────────────────────────────────────────────────────────────

function getEventLog({ source, entityType, status, limit = 50, offset = 0 } = {}) {
    let rows = [..._eventLog].reverse();
    if (source)     rows = rows.filter(e => e.source === source);
    if (entityType) rows = rows.filter(e => e.entityType === entityType);
    if (status)     rows = rows.filter(e => e.status === status);
    return { events: rows.slice(offset, offset + limit), total: rows.length };
}

function getStats() {
    return { ..._stats, logSize: _eventLog.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTENSION — register a custom normalizer for a new source
// ─────────────────────────────────────────────────────────────────────────────

function registerSource(source, normFn) {
    if (typeof normFn !== "function") throw new Error("normFn must be a function(raw) → { type, normalized }");
    _normalizers[source] = normFn;
    logger.info(`[BizAdapter] Registered custom normalizer for source: ${source}`);
}

module.exports = {
    ingest,
    normalize,
    toEntity,
    getEventLog,
    getStats,
    registerSource,
    SOURCES,
};
