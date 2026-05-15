"use strict";
/**
 * unifiedActionBus — central publish/subscribe hub coordinating action flow
 * across all action-bus subsystems.
 *
 * publish(spec)       → { published, actionId, dispatchId, routeResult }
 * subscribe(spec)     → { subscribed, subscriptionId, subsystem, eventType }
 * unsubscribe(spec)   → { unsubscribed, subscriptionId }
 * getBusState()       → BusState
 * getBusMetrics()     → BusMetrics
 * reset()
 *
 * Publish flow: validate envelope → route → dispatch to subscribers.
 * Subscribers registered per eventType ("*" = all).
 */

let _subscriptions = [];   // SubscriptionRecord[]
let _published     = [];   // PublishRecord[]
let _counter       = 0;

// ── subscribe ─────────────────────────────────────────────────────────

function subscribe(spec = {}) {
    const {
        subsystem  = null,
        eventType  = "*",
        handlerFn  = null,
        workflowId = null,
        priority   = 5,
    } = spec;

    if (!subsystem) return { subscribed: false, reason: "subsystem_required" };

    const subscriptionId = `sub-${++_counter}`;
    _subscriptions.push({
        subscriptionId, subsystem, eventType, handlerFn,
        workflowId, priority,
        active: true, subscribedAt: new Date().toISOString(),
    });

    return { subscribed: true, subscriptionId, subsystem, eventType, priority };
}

// ── unsubscribe ───────────────────────────────────────────────────────

function unsubscribe(spec = {}) {
    const { subscriptionId = null } = spec;
    if (!subscriptionId) return { unsubscribed: false, reason: "subscriptionId_required" };

    const idx = _subscriptions.findIndex(s => s.subscriptionId === subscriptionId);
    if (idx === -1) return { unsubscribed: false, reason: "subscription_not_found", subscriptionId };

    _subscriptions[idx].active = false;
    return { unsubscribed: true, subscriptionId };
}

// ── publish ───────────────────────────────────────────────────────────

function publish(spec = {}) {
    const {
        sourceSubsystem = null,
        actionType      = null,
        eventType       = null,
        payload         = {},
        workflowId      = null,
        correlationId   = null,
        envelope        = null,
    } = spec;

    if (!sourceSubsystem) return { published: false, reason: "sourceSubsystem_required" };

    const resolvedEventType = eventType || actionType || "action";
    const actionId          = `bus-action-${++_counter}`;
    const dispatchId        = `bus-dispatch-${++_counter}`;
    const timestamp         = new Date().toISOString();

    // Collect matching active subscribers in FIFO order
    const matching = _subscriptions.filter(s =>
        s.active && (s.eventType === "*" || s.eventType === resolvedEventType)
    );

    const deliveries = [];
    for (const sub of matching) {
        let outcome = "delivered";
        let error   = null;
        if (typeof sub.handlerFn === "function") {
            try {
                sub.handlerFn({
                    actionId, dispatchId, eventType: resolvedEventType,
                    sourceSubsystem, payload, workflowId, correlationId, envelope, timestamp,
                });
            } catch (e) {
                outcome = "failed";
                error   = e.message ?? "unknown_error";
            }
        }
        deliveries.push({ subscriptionId: sub.subscriptionId, subsystem: sub.subsystem, outcome, error });
    }

    const record = {
        actionId, dispatchId, sourceSubsystem, actionType, eventType: resolvedEventType,
        payload, workflowId, correlationId,
        subscriberCount: matching.length,
        failedCount: deliveries.filter(d => d.outcome === "failed").length,
        deliveries, timestamp,
    };
    _published.push(record);

    return {
        published: true, actionId, dispatchId,
        eventType: resolvedEventType, sourceSubsystem,
        subscriberCount: matching.length,
        deliveries,
    };
}

// ── getBusState ───────────────────────────────────────────────────────

function getBusState() {
    const activeSubscriptions = _subscriptions.filter(s => s.active);
    return {
        activeSubscriptions: activeSubscriptions.length,
        totalSubscriptions:  _subscriptions.length,
        publishedCount:      _published.length,
        subscriptions:       activeSubscriptions.map(s => ({
            subscriptionId: s.subscriptionId,
            subsystem: s.subsystem,
            eventType: s.eventType,
            priority: s.priority,
        })),
    };
}

// ── getBusMetrics ─────────────────────────────────────────────────────

function getBusMetrics() {
    const totalDeliveries = _published.reduce((s, p) => s + p.subscriberCount, 0);
    const totalFailed     = _published.reduce((s, p) => s + p.failedCount, 0);
    const uniqueSources   = new Set(_published.map(p => p.sourceSubsystem)).size;

    const byEventType = {};
    for (const p of _published) {
        byEventType[p.eventType] = (byEventType[p.eventType] ?? 0) + 1;
    }

    return {
        totalPublished:       _published.length,
        totalDeliveries,
        failedDeliveries:     totalFailed,
        activeSubscriptions:  _subscriptions.filter(s => s.active).length,
        uniqueSources,
        byEventType,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _subscriptions = [];
    _published     = [];
    _counter       = 0;
}

module.exports = {
    publish, subscribe, unsubscribe,
    getBusState, getBusMetrics, reset,
};
