/**
 * Digital Signature Agent — signature request workflow and verification.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");
const crypto = require("crypto");

function requestSignature({ tenantId, userId, documentId, documentTitle, signatories = [], deadline }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("digitalSignatureAgent", auth.error);
    if (!signatories.length) return fail("digitalSignatureAgent", "At least 1 signatory required");

    const req = {
        id:           uid("sig"),
        tenantId,
        documentId,
        documentTitle,
        requestedBy:  userId,
        signatories:  signatories.map(s => ({ userId: s, status: "pending", signedAt: null, hash: null })),
        status:       "pending",
        deadline:     deadline || null,
        createdAt:    NOW()
    };

    const sigs = load(tenantId, "signatures", []);
    sigs.push(req);
    flush(tenantId, "signatures", sigs.slice(-1000));
    auditLog(tenantId, userId, "signature_requested", { documentId, signatories });
    return ok("digitalSignatureAgent", req);
}

function sign({ tenantId, userId, requestId }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("digitalSignatureAgent", auth.error);

    const sigs = load(tenantId, "signatures", []);
    const req  = sigs.find(s => s.id === requestId);
    if (!req) return fail("digitalSignatureAgent", "Signature request not found");

    const signatory = req.signatories.find(s => s.userId === userId);
    if (!signatory) return forbidden("digitalSignatureAgent", "You are not a signatory");
    if (signatory.status === "signed") return fail("digitalSignatureAgent", "Already signed");

    const sigData   = `${tenantId}::${userId}::${requestId}::${NOW()}`;
    signatory.hash  = crypto.createHash("sha256").update(sigData).digest("hex");
    signatory.status   = "signed";
    signatory.signedAt = NOW();

    const allSigned = req.signatories.every(s => s.status === "signed");
    if (allSigned) req.status = "completed";

    flush(tenantId, "signatures", sigs);
    auditLog(tenantId, userId, "document_signed", { requestId, documentId: req.documentId });
    return ok("digitalSignatureAgent", { signed: true, hash: signatory.hash, allSigned, status: req.status });
}

function verifySignature({ tenantId, userId, requestId }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("digitalSignatureAgent", auth.error);

    const sig = load(tenantId, "signatures", []).find(s => s.id === requestId);
    if (!sig) return fail("digitalSignatureAgent", "Signature record not found");

    return ok("digitalSignatureAgent", {
        requestId,
        documentId:  sig.documentId,
        status:      sig.status,
        signatories: sig.signatories.map(s => ({ userId: s.userId, status: s.status, signedAt: s.signedAt, hashPreview: s.hash?.slice(0, 16) + "..." })),
        verified:    sig.status === "completed"
    });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "request_signature")  return requestSignature(p);
        if (task.type === "sign_document")      return sign(p);
        if (task.type === "verify_signature")   return verifySignature(p);
        return ok("digitalSignatureAgent", load(p.tenantId, "signatures", []));
    } catch (err) { return fail("digitalSignatureAgent", err.message); }
}

module.exports = { requestSignature, sign, verifySignature, run };
