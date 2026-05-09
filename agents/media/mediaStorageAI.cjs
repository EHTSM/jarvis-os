"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "mediaStorageAI";

const STORAGE_TIERS = {
    hot:    { accessFrequency:"daily",   costNote:"Highest cost/GB — use for active content",   latency:"<100ms", providers:["AWS S3 Standard","GCS Standard","Cloudflare R2 (no egress)"] },
    warm:   { accessFrequency:"weekly",  costNote:"Medium cost — recent but not daily",         latency:"<500ms", providers:["AWS S3 Intelligent-Tiering","GCS Nearline"] },
    cold:   { accessFrequency:"monthly", costNote:"Low cost — archive/old content",             latency:"1-5s",   providers:["AWS S3 Glacier","GCS Coldline","Backblaze B2"] },
    frozen: { accessFrequency:"rarely",  costNote:"Lowest cost — long-term backup",             latency:"hours",  providers:["AWS S3 Glacier Deep Archive","GCS Archive"] }
};

const NAMING_CONVENTION = (userId, contentType, contentId, fileName) =>
    `media/${userId}/${contentType}/${contentId}/${fileName}`;

function registerAsset({ userId, contentId, contentType, fileName, fileSizeMB, format, storageTier = "hot", tags = [], publicUrl }) {
    if (!userId || !fileName) return fail(AGENT, "userId and fileName required");
    trackEvent("media_store_register", { userId, contentType });

    const asset = {
        id:          uid("ms"),
        userId,
        contentId,
        contentType,
        fileName,
        storageKey:  NAMING_CONVENTION(userId, contentType || "misc", contentId || "uncategorised", fileName),
        fileSizeMB,
        format,
        storageTier,
        tags,
        publicUrl,
        accessCount: 0,
        lastAccessed:NOW(),
        status:      "active",
        registeredAt:NOW()
    };

    const assets = load(userId, "media_assets", []);
    assets.push(asset);
    flush(userId, "media_assets", assets.slice(-5000));

    return ok(AGENT, { asset, storageTierInfo: STORAGE_TIERS[storageTier] });
}

function listAssets({ userId, contentType, tag, storageTier, limit = 50 }) {
    if (!userId) return fail(AGENT, "userId required");
    let assets = load(userId, "media_assets", []);
    if (contentType) assets = assets.filter(a => a.contentType === contentType);
    if (tag)         assets = assets.filter(a => a.tags.includes(tag));
    if (storageTier) assets = assets.filter(a => a.storageTier === storageTier);

    const totalSizeMB = assets.reduce((s, a) => s + (a.fileSizeMB || 0), 0);
    return ok(AGENT, { assets: assets.slice(-limit).reverse(), total: assets.length, totalSizeMB: Math.round(totalSizeMB) });
}

function tierAsset({ userId, assetId, newTier }) {
    if (!userId || !assetId || !newTier) return fail(AGENT, "userId, assetId, newTier required");
    if (!STORAGE_TIERS[newTier]) return fail(AGENT, `Invalid tier. Options: ${Object.keys(STORAGE_TIERS).join(", ")}`);

    const assets = load(userId, "media_assets", []);
    const asset  = assets.find(a => a.id === assetId);
    if (!asset)  return fail(AGENT, "Asset not found");

    asset.storageTier = newTier;
    asset.tieredAt    = NOW();
    flush(userId, "media_assets", assets);

    return ok(AGENT, { assetId, newTier, tierInfo: STORAGE_TIERS[newTier] });
}

function deleteAsset({ userId, assetId }) {
    if (!userId || !assetId) return fail(AGENT, "userId and assetId required");
    const assets  = load(userId, "media_assets", []);
    const idx     = assets.findIndex(a => a.id === assetId);
    if (idx < 0)  return fail(AGENT, "Asset not found");
    const deleted = assets.splice(idx, 1)[0];
    flush(userId, "media_assets", assets);
    return ok(AGENT, { deleted: true, assetId, fileName: deleted.fileName });
}

function getStorageTiers() { return ok(AGENT, STORAGE_TIERS); }

module.exports = { registerAsset, listAssets, tierAsset, deleteAsset, getStorageTiers };
