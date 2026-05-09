/**
 * Firebase Agent — generates Auth, Firestore, and Storage setup files.
 */

const path   = require("path");
const fsUtil = require("../core/fileSystem.cjs");

const _config = (projectId) => `const admin = require("firebase-admin");
const sa    = require("./serviceAccountKey.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential:    admin.credential.cert(sa),
        projectId:     "${projectId}",
        storageBucket: "${projectId}.appspot.com"
    });
}

module.exports = { auth: admin.auth(), firestore: admin.firestore(), storage: admin.storage(), admin };
`;

const _auth = () => `const { auth } = require("./firebase.config");

async function createUser(email, password, displayName = "") {
    return auth.createUser({ email, password, displayName });
}
async function getUser(uid)    { return auth.getUser(uid); }
async function deleteUser(uid) { return auth.deleteUser(uid); }
async function verifyToken(token) { return auth.verifyIdToken(token); }
async function setClaims(uid, claims) {
    await auth.setCustomUserClaims(uid, claims);
    return { success: true };
}

async function authMiddleware(req, res, next) {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) return res.status(401).json({ error: "No token" });
    try { req.user = await verifyToken(h.split(" ")[1]); next(); }
    catch { res.status(401).json({ error: "Invalid token" }); }
}

module.exports = { createUser, getUser, deleteUser, verifyToken, setClaims, authMiddleware };
`;

const _firestoreRules = () => `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /public/{doc=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /admin/{doc=**} {
      allow read, write: if request.auth.token.admin == true;
    }
  }
}`;

const _storage = () => `const { storage } = require("./firebase.config");
const bucket = storage.bucket();

async function upload(localPath, remotePath, contentType = "application/octet-stream") {
    await bucket.upload(localPath, { destination: remotePath, metadata: { contentType } });
    const [url] = await bucket.file(remotePath).getSignedUrl({ action: "read", expires: Date.now() + 7 * 86400000 });
    return { success: true, url, path: remotePath };
}

async function remove(remotePath) {
    await bucket.file(remotePath).delete();
    return { success: true };
}

async function signedUrl(remotePath, expiresMs = 3600000) {
    const [url] = await bucket.file(remotePath).getSignedUrl({ action: "read", expires: Date.now() + expiresMs });
    return url;
}

module.exports = { upload, remove, signedUrl };
`;

const _storageRules = () => `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{uid}/{allPaths=**} {
      allow read:  if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid
                   && request.resource.size < 10 * 1024 * 1024;
    }
    match /public/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}`;

async function run(task) {
    const p          = task.payload || {};
    const projectId  = p.projectId  || "my-firebase-project";
    const outputDir  = p.outputDir  || `./generated/firebase/${projectId}`;
    const services   = p.services   || ["auth", "firestore", "storage"];

    const toWrite = [["firebase.config.js", _config(projectId)]];
    if (services.includes("auth"))     toWrite.push(["auth.js",            _auth()]);
    if (services.includes("firestore")) toWrite.push(["firestore.rules",   _firestoreRules()]);
    if (services.includes("storage"))  toWrite.push(["storage.js",         _storage()], ["storage.rules", _storageRules()]);

    const written = [];
    for (const [name, content] of toWrite) {
        await fsUtil.writeFile(path.join(outputDir, name), content);
        written.push(name);
    }

    return { success: true, projectId, outputDir, files: written, next: "npm install firebase-admin" };
}

module.exports = { run };
