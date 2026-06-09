"use strict";
/**
 * Repository Skeleton Generator — derives a complete folder/file structure
 * from a product blueprint and writes it to disk as runnable stubs.
 *
 * Entry points:
 *   blueprintToSkeleton(blueprint)           — pure: blueprint → skeleton manifest
 *   writeSkeleton(skeleton, targetDir)       — writes all files to disk
 *   generateSkeleton(blueprintId, targetDir) — load → derive → write → return manifest
 *   getSkeleton(blueprintId)                 — retrieve stored manifest
 *   listSkeletons(opts)                      — list recent skeleton runs
 *
 * Reuses:
 *   - blueprintGenerator.getBlueprint()  (data source)
 *   - blueprintGenerator._loadStore()    (same JSON store pattern)
 *
 * No AI calls — skeleton is a pure, deterministic derivation from the blueprint.
 * Every generated file is a valid, importable stub (not a comment placeholder).
 *
 * File map per blueprint layer:
 *   Root        package.json, README.md, .env.example, .gitignore
 *   Backend     backend/server.js
 *               backend/middleware/auth.js
 *               backend/db/index.js
 *               backend/db/migrations/<N>_<table>.sql  (one per table)
 *               backend/routes/<feature>.js            (one per feature)
 *   Frontend    frontend/package.json
 *               frontend/src/App.jsx
 *               frontend/src/api/client.js
 *               frontend/src/pages/<PageName>.jsx      (one per page)
 *   DevOps      Dockerfile
 *               docker-compose.yml
 *               .github/workflows/ci.yml
 *
 * Storage: data/skeletons.json  (max 20, newest-first, atomic write)
 */

const fs   = require("fs");
const path = require("path");

function _blueprintStore() { return require("./blueprintGenerator.cjs"); }

// ── Storage ───────────────────────────────────────────────────────
const STORE_PATH = path.join(__dirname, "../../data/skeletons.json");
const MAX_SK     = 20;

function _loadStore() {
    try {
        const raw = fs.readFileSync(STORE_PATH, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

function _saveStore(records) {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = STORE_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(records.slice(0, MAX_SK), null, 2));
    fs.renameSync(tmp, STORE_PATH);
}

function _persistSkeleton(record) {
    const records = _loadStore();
    const idx = records.findIndex(r => r.skeletonId === record.skeletonId);
    if (idx !== -1) records[idx] = record;
    else records.unshift(record);
    _saveStore(records);
}

// ── File content templates ────────────────────────────────────────
// All stubs are valid, runnable code — not placeholders.

function _pkgJson(productName, version = "1.0.0") {
    const safeName = productName.toLowerCase().replace(/\s+/g, "-");
    return JSON.stringify({
        name:        safeName,
        version,
        description: `${productName} backend service`,
        main:        "backend/server.js",
        scripts: {
            start:   "node backend/server.js",
            dev:     "nodemon backend/server.js",
            test:    "node --test tests/",
            migrate: "node backend/db/migrate.js",
        },
        dependencies: {
            express:        "^4.18.2",
            cors:           "^2.8.5",
            dotenv:         "^16.3.1",
            "better-sqlite3": "^9.4.3",
            jsonwebtoken:   "^9.0.2",
            bcryptjs:       "^2.4.3",
        },
        devDependencies: {
            nodemon: "^3.0.3",
        },
    }, null, 2);
}

function _frontendPkgJson(productName) {
    const safeName = productName.toLowerCase().replace(/\s+/g, "-") + "-frontend";
    return JSON.stringify({
        name:    safeName,
        version: "1.0.0",
        private: true,
        scripts: {
            start: "react-scripts start",
            build: "react-scripts build",
            test:  "react-scripts test",
        },
        dependencies: {
            react:        "^18.2.0",
            "react-dom":  "^18.2.0",
            "react-router-dom": "^6.21.0",
            axios:        "^1.6.5",
            "react-scripts": "5.0.1",
        },
    }, null, 2);
}

function _readme(productName, description, features) {
    const featureList = (features || []).map(f => `- **${f.name}** — ${f.description || ""}`).join("\n");
    return `# ${productName}\n\n${description}\n\n## Features\n\n${featureList}\n\n## Getting Started\n\n\`\`\`bash\nnpm install\ncp .env.example .env\nnpm run migrate\nnpm start\n\`\`\`\n`;
}

function _envExample(productName) {
    const safeName = productName.toUpperCase().replace(/\s+/g, "_");
    return [
        `# ${productName} environment`,
        "PORT=3000",
        "NODE_ENV=development",
        `JWT_SECRET=change_me_${safeName.toLowerCase()}_secret`,
        "DATABASE_URL=./data/app.db",
        "",
    ].join("\n");
}

function _gitignore() {
    return [
        "node_modules/",
        "dist/",
        "build/",
        ".env",
        "*.db",
        "data/*.json",
        ".DS_Store",
        "coverage/",
        "",
    ].join("\n");
}

function _backendServer(productName, featureNames) {
    const requires = featureNames
        .map(n => {
            const safe = n.toLowerCase().replace(/\s+/g, "-");
            return `const ${safe.replace(/-/g, "_")}Routes = require("./routes/${safe}");`;
        })
        .join("\n");
    const uses = featureNames
        .map(n => {
            const safe    = n.toLowerCase().replace(/\s+/g, "-");
            const varName = safe.replace(/-/g, "_") + "Routes";
            const prefix  = "/api/" + safe;
            return `app.use("${prefix}", ${varName});`;
        })
        .join("\n");

    return `"use strict";
require("dotenv").config();
const express = require("express");
const cors    = require("cors");
${requires}

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok", product: "${productName}" }));

${uses}

app.listen(PORT, () => console.log(\`[${productName}] server running on port \${PORT}\`));
module.exports = app;
`;
}

function _routeFile(featureName, apis) {
    const routeLines = apis.map(api => {
        const method = api.method.toLowerCase();
        const routePath = api.path.replace(/^\/api\/[^/]+/, "") || "/";
        return `router.${method}("${routePath}", async (req, res) => {\n  // ${api.description}\n  res.json({ ok: true, feature: "${featureName}" });\n});`;
    });
    return `"use strict";
const router = require("express").Router();

${routeLines.join("\n\n")}

module.exports = router;
`;
}

function _dbIndex() {
    return `"use strict";
const Database = require("better-sqlite3");
const path     = require("path");

const DB_PATH = process.env.DATABASE_URL || path.join(__dirname, "../../data/app.db");
let   _db     = null;

function getDB() {
    if (!_db) {
        _db = new Database(DB_PATH);
        _db.pragma("journal_mode = WAL");
        _db.pragma("foreign_keys = ON");
    }
    return _db;
}

module.exports = { getDB };
`;
}

function _migration(seq, tableName, columns) {
    const colDefs = columns.map((c, i) => {
        if (i === 0) return `    ${c} INTEGER PRIMARY KEY AUTOINCREMENT`;
        if (c.endsWith("_id")) return `    ${c} INTEGER REFERENCES ${c.replace("_id", "s")}(id)`;
        if (c === "created_at" || c === "updated_at") return `    ${c} TEXT DEFAULT CURRENT_TIMESTAMP`;
        if (c.includes("email") || c.includes("name") || c.includes("title")) return `    ${c} TEXT NOT NULL`;
        return `    ${c} TEXT`;
    });
    return `-- Migration ${String(seq).padStart(3, "0")}: create ${tableName} table
-- Generated by repoSkeletonGenerator

CREATE TABLE IF NOT EXISTS ${tableName} (
${colDefs.join(",\n")}
);
`;
}

function _authMiddleware() {
    return `"use strict";
const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    try {
        req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: "Invalid token" });
    }
}

module.exports = { requireAuth };
`;
}

function _apiClient() {
    return `import axios from "axios";

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "http://localhost:3000/api",
  timeout: 10000,
});

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem("token");
  if (token) cfg.headers.Authorization = \`Bearer \${token}\`;
  return cfg;
});

export default api;
`;
}

function _appJsx(productName, pages) {
    const imports = pages
        .map(p => {
            const comp = p.name.replace(/\s+/g, "");
            const file = p.name.toLowerCase().replace(/\s+/g, "");
            return `import ${comp} from "./pages/${file}";`;
        })
        .join("\n");
    const routes = pages
        .map(p => {
            const comp = p.name.replace(/\s+/g, "");
            return `      <Route path="${p.route}" element={<${comp} />} />`;
        })
        .join("\n");

    return `import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
${imports}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
${routes}
      </Routes>
    </BrowserRouter>
  );
}
`;
}

function _pageJsx(pageName, route, description) {
    const comp = pageName.replace(/\s+/g, "");
    return `import React, { useEffect, useState } from "react";
import api from "../api/client";

export default function ${comp}() {
  const [data, setData] = useState(null);

  useEffect(() => {
    // ${description}
    // api.get("...").then(r => setData(r.data));
  }, []);

  return (
    <div>
      <h1>${pageName}</h1>
      <p>Route: ${route}</p>
      {data && <pre>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
`;
}

function _dockerfile(productName) {
    return `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "backend/server.js"]
# ${productName}
`;
}

function _dockerCompose(productName) {
    const safe = productName.toLowerCase().replace(/\s+/g, "-");
    return `version: "3.8"
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
    volumes:
      - ./data:/app/data
    restart: unless-stopped
    container_name: ${safe}
`;
}

function _ciWorkflow(productName) {
    return `name: CI

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm test
    # ${productName} CI
`;
}

// ── Pure skeleton builder ─────────────────────────────────────────
/**
 * Derives the complete file manifest from a blueprint.
 * Pure function — no I/O, no AI.
 *
 * @returns {object} skeleton
 *   {
 *     productName, blueprintId,
 *     files: [ { filePath, content, layer } ],
 *     dirs:  [ dirPath, … ],
 *     stats: { total, byLayer: { root, backend, frontend, devops } }
 *   }
 */
function blueprintToSkeleton(blueprint) {
    const files = [];
    const dirs  = new Set();

    function addFile(filePath, content, layer) {
        files.push({ filePath, content, layer });
        dirs.add(path.dirname(filePath));
    }

    const { productName, features = [], pages = [], apis = [], database = {} } = blueprint;
    const tables = database.tables || [];

    // Unique feature names for route generation
    const featureNames = [...new Set(features.map(f => f.name))];

    // API index by featureId
    const apisByFeature = new Map();
    for (const api of apis) {
        for (const fid of (api.featureIds || [])) {
            if (!apisByFeature.has(fid)) apisByFeature.set(fid, []);
            apisByFeature.get(fid).push(api);
        }
    }

    // ── Root layer ────────────────────────────────────────────────
    addFile("package.json",  _pkgJson(productName),                          "root");
    addFile("README.md",     _readme(productName, blueprint.description, features), "root");
    addFile(".env.example",  _envExample(productName),                       "root");
    addFile(".gitignore",    _gitignore(),                                    "root");

    // ── Backend layer ─────────────────────────────────────────────
    addFile("backend/server.js",          _backendServer(productName, featureNames), "backend");
    addFile("backend/middleware/auth.js", _authMiddleware(),                         "backend");
    addFile("backend/db/index.js",        _dbIndex(),                                "backend");

    // One migration file per table
    tables.forEach((table, i) => {
        const safeName = table.name.toLowerCase().replace(/\s+/g, "_");
        addFile(
            `backend/db/migrations/${String(i + 1).padStart(3, "0")}_${safeName}.sql`,
            _migration(i + 1, table.name, table.columns),
            "backend",
        );
    });

    // One route file per feature (aggregates all apis for that feature)
    for (const feature of features) {
        const safeName  = feature.name.toLowerCase().replace(/\s+/g, "-");
        const featureApis = apisByFeature.get(feature.id) || [];
        addFile(`backend/routes/${safeName}.js`, _routeFile(feature.name, featureApis), "backend");
    }

    // ── Frontend layer ────────────────────────────────────────────
    addFile("frontend/package.json",      _frontendPkgJson(productName), "frontend");
    addFile("frontend/src/App.jsx",       _appJsx(productName, pages),   "frontend");
    addFile("frontend/src/api/client.js", _apiClient(),                  "frontend");

    // One page component per page
    for (const page of pages) {
        const safeName = page.name.toLowerCase().replace(/\s+/g, "");
        addFile(`frontend/src/pages/${safeName}.jsx`, _pageJsx(page.name, page.route, page.description || ""), "frontend");
    }

    // ── DevOps layer ──────────────────────────────────────────────
    addFile("Dockerfile",                    _dockerfile(productName),   "devops");
    addFile("docker-compose.yml",            _dockerCompose(productName),"devops");
    addFile(".github/workflows/ci.yml",      _ciWorkflow(productName),   "devops");

    const byLayer = { root: 0, backend: 0, frontend: 0, devops: 0 };
    for (const f of files) byLayer[f.layer] = (byLayer[f.layer] || 0) + 1;

    return {
        productName,
        blueprintId:  blueprint.blueprintId,
        files,
        dirs:         [...dirs].sort(),
        stats:        { total: files.length, byLayer },
    };
}

// ── Disk writer ───────────────────────────────────────────────────
/**
 * Writes a skeleton manifest to the target directory.
 * Creates all directories first, then writes files.
 * Will not overwrite an existing file unless opts.overwrite is true.
 *
 * @param {object} skeleton   — result of blueprintToSkeleton()
 * @param {string} targetDir  — absolute path to write into
 * @param {object} opts
 * @param {boolean} opts.overwrite  — overwrite existing files (default false)
 *
 * @returns {{ written: string[], skipped: string[], errors: string[] }}
 */
function writeSkeleton(skeleton, targetDir, { overwrite = false } = {}) {
    const written = [], skipped = [], errors = [];

    // Create all directories
    for (const dir of skeleton.dirs) {
        const absDir = path.join(targetDir, dir);
        try { fs.mkdirSync(absDir, { recursive: true }); } catch (e) { /* already exists */ }
    }
    // Ensure targetDir itself exists
    fs.mkdirSync(targetDir, { recursive: true });

    // Write files
    for (const { filePath, content } of skeleton.files) {
        const absPath = path.join(targetDir, filePath);
        // Ensure parent dir exists even if not in skeleton.dirs
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        try {
            if (!overwrite && fs.existsSync(absPath)) {
                skipped.push(filePath);
                continue;
            }
            fs.writeFileSync(absPath, content, "utf8");
            written.push(filePath);
        } catch (e) {
            errors.push(`${filePath}: ${e.message}`);
        }
    }

    return { written, skipped, errors };
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Load a blueprint, derive its repo skeleton, write to targetDir,
 * and persist a skeleton manifest.
 *
 * @param {string} blueprintId
 * @param {string} targetDir   — absolute path where repo will be written
 * @param {object} opts
 * @param {boolean} opts.overwrite  — overwrite existing files (default false)
 *
 * @returns {{
 *   skeletonId, blueprintId, productName, targetDir,
 *   stats, written, skipped, errors, generatedAt
 * }}
 */
function generateSkeleton(blueprintId, targetDir, opts = {}) {
    const bp = _blueprintStore().getBlueprint(blueprintId);
    if (!bp) throw new Error(`Blueprint not found: ${blueprintId}`);

    const skeleton    = blueprintToSkeleton(bp);
    const writeResult = writeSkeleton(skeleton, targetDir, opts);

    const skeletonId = `sk_${Date.now()}`;
    const record = {
        skeletonId,
        blueprintId,
        productName: bp.productName,
        targetDir,
        stats:       skeleton.stats,
        written:     writeResult.written,
        skipped:     writeResult.skipped,
        errors:      writeResult.errors,
        generatedAt: new Date().toISOString(),
    };

    _persistSkeleton(record);

    console.log(`[Skeleton:${skeletonId}] "${bp.productName}" → ${targetDir}`);
    console.log(`[Skeleton] written:${writeResult.written.length} skipped:${writeResult.skipped.length} errors:${writeResult.errors.length}`);
    console.log(`[Skeleton] layers — root:${skeleton.stats.byLayer.root} backend:${skeleton.stats.byLayer.backend} frontend:${skeleton.stats.byLayer.frontend} devops:${skeleton.stats.byLayer.devops}`);

    return record;
}

/** Retrieve a skeleton manifest by blueprintId or skeletonId. */
function getSkeleton(id) {
    return _loadStore().find(r => r.skeletonId === id || r.blueprintId === id) || null;
}

/** List recent skeleton runs. */
function listSkeletons({ limit = 20 } = {}) {
    return _loadStore().slice(0, limit).map(r => ({
        skeletonId:  r.skeletonId,
        blueprintId: r.blueprintId,
        productName: r.productName,
        targetDir:   r.targetDir,
        stats:       r.stats,
        errors:      r.errors?.length ?? 0,
        generatedAt: r.generatedAt,
    }));
}

module.exports = {
    blueprintToSkeleton,
    writeSkeleton,
    generateSkeleton,
    getSkeleton,
    listSkeletons,
};
