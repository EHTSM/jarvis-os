"use strict";
const { loadUser, flushUser, loadGlobal, flushGlobal, metaLog, uid, hash, NOW, ok, fail, blocked } = require("./_metaverseStore.cjs");

const AGENT = "digitalAssetManager";

const ASSET_TYPES  = ["avatar_skin","wearable","prop","scene_pack","audio_clip","script","texture","material","prefab","nft_item"];
const FORMATS      = ["glb","gltf","fbx","obj","png","jpg","webp","mp3","ogg","json","wasm"];
const MAX_FILE_MB  = 100;
const MAX_NAME_LEN = 200;

function uploadAsset({ ownerId, assetName, assetType, format, fileSizeMB, metadata = {}, worldId, tags = [] }) {
    if (!ownerId || !assetName)   return fail(AGENT, "ownerId and assetName required");
    if (!ASSET_TYPES.includes(assetType)) return fail(AGENT, `assetType must be: ${ASSET_TYPES.join(", ")}`);
    if (!FORMATS.includes(format))        return fail(AGENT, `format must be: ${FORMATS.join(", ")}`);
    if (assetName.length > MAX_NAME_LEN)  return fail(AGENT, `assetName max ${MAX_NAME_LEN} chars`);
    if (typeof fileSizeMB !== "number" || fileSizeMB <= 0) return fail(AGENT, "fileSizeMB must be > 0");
    if (fileSizeMB > MAX_FILE_MB) return blocked(AGENT, `file too large (max ${MAX_FILE_MB} MB)`);

    const asset = {
        assetId:    uid("ast"),
        ownerId,
        assetName,
        assetType,
        format,
        fileSizeMB,
        tags:       tags.slice(0,20),
        worldId:    worldId || null,
        metadata,
        assetHash:  hash({ ownerId, assetName, format, fileSizeMB }),
        storagePath:`metaverse_assets/${ownerId}/${uid("file")}.${format}`,
        status:     "active",
        downloads:  0,
        uploadedAt: NOW()
    };

    const inventory = loadUser(ownerId, "digital_assets", []);
    inventory.push({ assetId:asset.assetId, assetName, assetType, format, fileSizeMB, uploadedAt:asset.uploadedAt });
    flushUser(ownerId, "digital_assets", inventory.slice(-10000));
    flushGlobal(`asset_${asset.assetId}`, asset);

    // world-level asset registry
    if (worldId) {
        const worldAssets = loadGlobal(`world_assets_${worldId}`, []);
        worldAssets.push({ assetId:asset.assetId, assetName, assetType, ownerId });
        flushGlobal(`world_assets_${worldId}`, worldAssets.slice(-5000));
    }

    metaLog(AGENT, ownerId, "asset_uploaded", { assetId:asset.assetId, assetType, fileSizeMB }, "INFO");
    return ok(AGENT, asset);
}

function getAsset({ assetId }) {
    if (!assetId) return fail(AGENT, "assetId required");
    const asset = loadGlobal(`asset_${assetId}`);
    if (!asset) return fail(AGENT, `assetId ${assetId} not found`);
    asset.downloads++;
    flushGlobal(`asset_${assetId}`, asset);
    return ok(AGENT, asset);
}

function listUserAssets({ ownerId, assetType, format, limit = 50 }) {
    if (!ownerId) return fail(AGENT, "ownerId required");
    let inventory = loadUser(ownerId, "digital_assets", []);
    if (assetType) inventory = inventory.filter(a => a.assetType === assetType);
    if (format)    inventory = inventory.filter(a => a.format === format);
    return ok(AGENT, { total:inventory.length, assets:inventory.slice(-limit).reverse(), assetTypes:ASSET_TYPES, formats:FORMATS });
}

function deleteAsset({ ownerId, assetId, confirm }) {
    if (!ownerId || !assetId) return fail(AGENT, "ownerId and assetId required");
    if (!confirm) return fail(AGENT, "confirm:true required to delete an asset");
    const asset = loadGlobal(`asset_${assetId}`);
    if (!asset) return fail(AGENT, `assetId ${assetId} not found`);
    if (asset.ownerId !== ownerId) return blocked(AGENT, "only the owner can delete this asset");

    asset.status = "deleted";
    asset.deletedAt = NOW();
    flushGlobal(`asset_${assetId}`, asset);

    let inventory = loadUser(ownerId, "digital_assets", []);
    inventory = inventory.filter(a => a.assetId !== assetId);
    flushUser(ownerId, "digital_assets", inventory);

    metaLog(AGENT, ownerId, "asset_deleted", { assetId }, "WARN");
    return ok(AGENT, { deleted: assetId });
}

function transferAssetOwnership({ fromId, toId, assetId }) {
    if (!fromId || !toId || !assetId) return fail(AGENT, "fromId, toId, and assetId required");
    const asset = loadGlobal(`asset_${assetId}`);
    if (!asset) return fail(AGENT, `assetId ${assetId} not found`);
    if (asset.ownerId !== fromId) return blocked(AGENT, "only the current owner can transfer this asset");

    asset.ownerId = toId;
    asset.transferredFrom = fromId;
    asset.transferredAt = NOW();
    flushGlobal(`asset_${assetId}`, asset);

    let fromInv = loadUser(fromId, "digital_assets", []);
    fromInv = fromInv.filter(a => a.assetId !== assetId);
    flushUser(fromId, "digital_assets", fromInv);

    const toInv = loadUser(toId, "digital_assets", []);
    toInv.push({ assetId, assetName:asset.assetName, assetType:asset.assetType, format:asset.format, fileSizeMB:asset.fileSizeMB, acquiredAt:NOW() });
    flushUser(toId, "digital_assets", toInv);

    metaLog(AGENT, fromId, "asset_transferred", { assetId, toId }, "INFO");
    return ok(AGENT, { transferred:assetId, from:fromId, to:toId });
}

module.exports = { uploadAsset, getAsset, listUserAssets, deleteAsset, transferAssetOwnership };
