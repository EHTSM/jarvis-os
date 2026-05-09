/**
 * Document Collaboration Agent — collaborative doc editing with version history.
 */

const { load, flush, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

function createDoc({ tenantId, userId, title, content = "", template = "blank" }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("documentCollaborationAgent", auth.error);

    const TEMPLATES = {
        blank:   "",
        meeting: "## Meeting Notes\n\n**Date:**\n**Attendees:**\n\n### Agenda\n\n### Decisions\n\n### Action Items",
        report:  "## Report\n\n**Period:**\n**Author:**\n\n### Summary\n\n### Details\n\n### Recommendations",
        sop:     "## Standard Operating Procedure\n\n**Department:**\n\n### Purpose\n\n### Steps\n\n### Notes"
    };

    const doc = {
        id:        uid("doc"),
        tenantId,
        title,
        content:   content || (TEMPLATES[template] || ""),
        template,
        collaborators: [userId],
        version:   1,
        history:   [],
        status:    "draft",
        createdBy: userId,
        createdAt: NOW(),
        updatedAt: NOW()
    };

    const docs = load(tenantId, "docs", []);
    docs.push(doc);
    flush(tenantId, "docs", docs.slice(-1000));
    auditLog(tenantId, userId, "doc_created", { title });
    return ok("documentCollaborationAgent", doc);
}

function editDoc({ tenantId, userId, docId, content, title }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("documentCollaborationAgent", auth.error);

    const docs = load(tenantId, "docs", []);
    const doc  = docs.find(d => d.id === docId);
    if (!doc) return fail("documentCollaborationAgent", "Document not found");
    if (!doc.collaborators.includes(userId)) return forbidden("documentCollaborationAgent", "Not a collaborator");

    doc.history.push({ version: doc.version, content: doc.content, editedBy: userId, at: NOW() });
    doc.history = doc.history.slice(-20);
    doc.version++;
    if (content !== undefined) doc.content = content;
    if (title !== undefined)   doc.title   = title;
    doc.updatedAt = NOW();

    flush(tenantId, "docs", docs);
    auditLog(tenantId, userId, "doc_edited", { docId, version: doc.version });
    return ok("documentCollaborationAgent", { docId, version: doc.version, updatedAt: doc.updatedAt });
}

function addCollaborator({ tenantId, userId, docId, collaboratorId }) {
    const auth = requireAuth(tenantId, userId, "employee");
    if (!auth.ok) return forbidden("documentCollaborationAgent", auth.error);

    const docs = load(tenantId, "docs", []);
    const doc  = docs.find(d => d.id === docId);
    if (!doc) return fail("documentCollaborationAgent", "Document not found");
    if (doc.createdBy !== userId) return forbidden("documentCollaborationAgent", "Only doc owner can add collaborators");

    if (!doc.collaborators.includes(collaboratorId)) doc.collaborators.push(collaboratorId);
    flush(tenantId, "docs", docs);
    return ok("documentCollaborationAgent", { added: true, collaboratorId });
}

function listDocs(tenantId, requesterId) {
    const auth = requireAuth(tenantId, requesterId, "employee");
    if (!auth.ok) return forbidden("documentCollaborationAgent", auth.error);

    const docs = load(tenantId, "docs", []).filter(d => d.collaborators.includes(requesterId) || d.createdBy === requesterId);
    return ok("documentCollaborationAgent", { docs: docs.map(d => ({ id: d.id, title: d.title, version: d.version, updatedAt: d.updatedAt })), total: docs.length });
}

async function run(task) {
    const p = task.payload || {};
    try {
        if (task.type === "create_doc")         return createDoc(p);
        if (task.type === "edit_doc")            return editDoc(p);
        if (task.type === "add_collaborator")    return addCollaborator(p);
        return listDocs(p.tenantId, p.userId);
    } catch (err) { return fail("documentCollaborationAgent", err.message); }
}

module.exports = { createDoc, editDoc, addCollaborator, listDocs, run };
