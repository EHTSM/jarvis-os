/**
 * FileSystem helper — shared file I/O for all dev agents.
 */

const fs   = require("fs");
const path = require("path");

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

async function writeFile(filePath, content) {
    ensureDir(path.dirname(filePath));
    await fs.promises.writeFile(filePath, content, "utf8");
    return { path: filePath, bytes: Buffer.byteLength(content, "utf8") };
}

async function readFile(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return fs.promises.readFile(filePath, "utf8");
}

function exists(filePath) {
    return fs.existsSync(filePath);
}

function listFiles(dirPath, ext = null) {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath, { withFileTypes: true })
        .filter(f => f.isFile() && (!ext || f.name.endsWith(ext)))
        .map(f => path.join(dirPath, f.name));
}

module.exports = { ensureDir, writeFile, readFile, exists, listFiles };
