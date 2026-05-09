/**
 * Database Agent — generates Mongoose schemas and Firestore CRUD modules.
 */

const path   = require("path");
const fsUtil = require("../core/fileSystem.cjs");

function _mongooseSchema(modelName, fields) {
    const Model = modelName.charAt(0).toUpperCase() + modelName.slice(1);
    const defaults = [
        { name: "name",   type: "String",  required: true },
        { name: "active", type: "Boolean", default: true  }
    ];
    const finalFields = (fields && fields.length > 0) ? fields : defaults;

    const fieldLines = finalFields.map(f => {
        const parts = [`type: ${f.type || "String"}`];
        if (f.required)              parts.push("required: true");
        if (f.unique)                parts.push("unique: true");
        if (f.default !== undefined) parts.push(`default: ${JSON.stringify(f.default)}`);
        if (f.ref)                   parts.push(`ref: "${f.ref}"`);
        if (f.enum)                  parts.push(`enum: ${JSON.stringify(f.enum)}`);
        return `    ${f.name}: { ${parts.join(", ")} }`;
    }).join(",\n");

    const indexes = finalFields
        .filter(f => f.index || f.unique)
        .map(f => `${Model}Schema.index({ ${f.name}: 1 });`)
        .join("\n");

    return `const mongoose = require("mongoose");

const ${Model}Schema = new mongoose.Schema({
${fieldLines}
}, { timestamps: true });

${indexes}

${Model}Schema.statics.findActive = function () {
    return this.find({ active: { $ne: false } });
};

module.exports = mongoose.model("${Model}", ${Model}Schema);
`;
}

function _firestoreCrud(collectionName, fields) {
    const sampleDoc = (fields || []).reduce((acc, f) => {
        acc[f.name] = f.example !== undefined ? f.example
            : f.type === "Number" ? 0
            : f.type === "Boolean" ? false : "";
        return acc;
    }, {});

    return `const admin = require("firebase-admin");
const db  = admin.firestore();
const col = db.collection("${collectionName}");

// Sample document shape: ${JSON.stringify(sampleDoc)}

async function create(data) {
    const ref = await col.add({ ...data, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return { id: ref.id, ...data };
}

async function getAll(limit = 50) {
    const snap = await col.orderBy("createdAt", "desc").limit(limit).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getById(id) {
    const doc = await col.doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function update(id, data) {
    await col.doc(id).update({ ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return getById(id);
}

async function remove(id) {
    await col.doc(id).delete();
    return { success: true, id };
}

module.exports = { create, getAll, getById, update, remove };
`;
}

async function run(task) {
    const p           = task.payload || {};
    const dbType      = p.dbType      || "mongodb";
    const modelName   = p.modelName   || "Item";
    const fields      = p.fields      || [];
    const outputPath  = p.outputPath  || null;

    const code = dbType === "firestore"
        ? _firestoreCrud(modelName.toLowerCase() + "s", fields)
        : _mongooseSchema(modelName, fields);

    let written = null;
    if (outputPath) {
        const ext      = dbType === "firestore" ? "firestore.js" : "model.js";
        const fullPath = path.join(outputPath, `${modelName}.${ext}`);
        written = await fsUtil.writeFile(fullPath, code);
    }

    return { success: true, dbType, modelName, code, written };
}

module.exports = { run };
