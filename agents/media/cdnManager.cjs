"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "cdnManager";

const CDN_PROVIDERS = {
    cloudflare:  { name:"Cloudflare", freeTier:true,  bandwidthFree:"Unlimited",  regions:"global",   latency:"<50ms", setup:"cf-workers + R2 storage" },
    bunnycdn:    { name:"BunnyCDN",   freeTier:false, bandwidthFree:"14-day trial",regions:"global",   latency:"<50ms", priceNote:"$0.01/GB", note:"Best price/performance" },
    cloudfront:  { name:"AWS CloudFront",freeTier:true,bandwidthFree:"1TB/month", regions:"global",   latency:"<100ms",note:"Pay per GB after free tier" },
    fastly:      { name:"Fastly",     freeTier:false, bandwidthFree:"N/A",        regions:"global",   latency:"<30ms", note:"Enterprise-grade, expensive" },
    gcore:       { name:"Gcore CDN",  freeTier:true,  bandwidthFree:"1TB/month",  regions:"global",   latency:"<40ms", note:"Good India PoPs" },
    cloudinary:  { name:"Cloudinary", freeTier:true,  bandwidthFree:"25GB/month", regions:"global",   latency:"<100ms",note:"Best for images + video transform API" }
};

const CACHE_POLICIES = {
    static_forever: { maxAge:31536000, staleWhileRevalidate:86400,  note:"Images, fonts, versioned files" },
    video_segments: { maxAge:31536000, staleWhileRevalidate:0,       note:"HLS/DASH segments — immutable" },
    api_short:      { maxAge:60,       staleWhileRevalidate:30,       note:"Dynamic data with short TTL" },
    no_cache:       { maxAge:0,        staleWhileRevalidate:0,        note:"Private or frequently changing" }
};

function planCDNDeployment({ userId, contentType, expectedMonthlyGBTransfer, regions = ["global"], latencyPriority = "medium" }) {
    if (!userId) return fail(AGENT, "userId required");
    trackEvent("cdn_plan", { userId, contentType });

    const suggestions = Object.entries(CDN_PROVIDERS).map(([key, cdn]) => ({
        key,
        ...cdn,
        suitabilityScore: (
            (cdn.freeTier ? 3 : 0) +
            (cdn.latency < "<40ms" ? 2 : cdn.latency === "<50ms" ? 1 : 0) +
            (regions.includes("global") ? 2 : 0)
        )
    })).sort((a, b) => b.suitabilityScore - a.suitabilityScore);

    const cachePolicy = contentType === "video" ? CACHE_POLICIES.video_segments
        : contentType === "image" ? CACHE_POLICIES.static_forever
        : CACHE_POLICIES.static_forever;

    const plan = {
        id:            uid("cdn"),
        userId,
        contentType,
        expectedMonthlyGBTransfer,
        regions,
        latencyPriority,
        recommendedCDN:  suggestions[0],
        allOptions:      suggestions,
        cachePolicy,
        headerTemplate:  `Cache-Control: public, max-age=${cachePolicy.maxAge}, stale-while-revalidate=${cachePolicy.staleWhileRevalidate}`,
        invalidationNote:"Use cdn.purge(url) or API endpoint to bust cache after content updates",
        createdAt:       NOW()
    };

    const plans = load(userId, "cdn_plans", []);
    plans.push(plan);
    flush(userId, "cdn_plans", plans.slice(-20));

    return ok(AGENT, { plan });
}

function getCDNProviders() { return ok(AGENT, { providers: CDN_PROVIDERS, cachePolicies: CACHE_POLICIES }); }

module.exports = { planCDNDeployment, getCDNProviders };
