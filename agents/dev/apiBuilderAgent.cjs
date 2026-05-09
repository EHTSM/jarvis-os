/**
 * API Builder Agent — generates complete REST API project structure.
 * Produces: server.js, routes, controllers, models, package.json
 */

const path   = require("path");
const fsUtil = require("../core/fileSystem.cjs");

function _serverCode(name, port) {
    return `require("dotenv").config();
const express  = require("express");
const cors     = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Routes
app.use("/api/${name}s", require("./routes/${name}"));

// Health check
app.get("/health", (req, res) => res.json({ status: "ok", service: "${name}-api", ts: new Date().toISOString() }));

// 404 handler
app.use((req, res) => res.status(404).json({ success: false, error: "Route not found" }));

// Error handler
app.use((err, req, res, _next) => {
    console.error(err.stack);
    res.status(500).json({ success: false, error: err.message });
});

// Database + start
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/${name}-db";
mongoose.connect(MONGO_URI)
    .then(() => {
        app.listen(${port}, () => console.log(\`${name} API running on port ${port}\`));
    })
    .catch(err => { console.error("DB connection failed:", err.message); process.exit(1); });

module.exports = app;
`;
}

function _routeCode(name) {
    const ctrl = `${name}Controller`;
    return `const router     = require("express").Router();
const ${ctrl} = require("../controllers/${name}Controller");

router.get("/",    ${ctrl}.getAll);
router.get("/:id", ${ctrl}.getById);
router.post("/",   ${ctrl}.create);
router.put("/:id", ${ctrl}.update);
router.delete("/:id", ${ctrl}.remove);

module.exports = router;
`;
}

function _controllerCode(name) {
    const Model = name.charAt(0).toUpperCase() + name.slice(1);
    return `const ${Model} = require("../models/${name}");

exports.getAll = async (req, res) => {
    try {
        const { page = 1, limit = 20, ...filters } = req.query;
        const items = await ${Model}.find(filters)
            .skip((page - 1) * limit).limit(Number(limit)).sort({ createdAt: -1 });
        const total = await ${Model}.countDocuments(filters);
        res.json({ success: true, data: items, total, page: Number(page), limit: Number(limit) });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
};

exports.getById = async (req, res) => {
    try {
        const item = await ${Model}.findById(req.params.id);
        if (!item) return res.status(404).json({ success: false, error: "${Model} not found" });
        res.json({ success: true, data: item });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
};

exports.create = async (req, res) => {
    try {
        const item = await ${Model}.create(req.body);
        res.status(201).json({ success: true, data: item });
    } catch (err) { res.status(400).json({ success: false, error: err.message }); }
};

exports.update = async (req, res) => {
    try {
        const item = await ${Model}.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!item) return res.status(404).json({ success: false, error: "${Model} not found" });
        res.json({ success: true, data: item });
    } catch (err) { res.status(400).json({ success: false, error: err.message }); }
};

exports.remove = async (req, res) => {
    try {
        const item = await ${Model}.findByIdAndDelete(req.params.id);
        if (!item) return res.status(404).json({ success: false, error: "${Model} not found" });
        res.json({ success: true, message: "Deleted successfully" });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
};
`;
}

function _modelCode(name, fields) {
    const Model = name.charAt(0).toUpperCase() + name.slice(1);
    const defaultFields = [
        { name: "name",      type: "String",  required: true },
        { name: "active",    type: "Boolean", default: true  },
        { name: "createdBy", type: "String"                  }
    ];
    const finalFields = fields.length > 0 ? fields : defaultFields;

    const fieldLines = finalFields.map(f => {
        const parts = [`type: ${f.type || "String"}`];
        if (f.required)                parts.push("required: true");
        if (f.unique)                  parts.push("unique: true");
        if (f.default !== undefined)   parts.push(`default: ${JSON.stringify(f.default)}`);
        if (f.enum)                    parts.push(`enum: ${JSON.stringify(f.enum)}`);
        return `    ${f.name}: { ${parts.join(", ")} }`;
    }).join(",\n");

    return `const mongoose = require("mongoose");

const ${Model}Schema = new mongoose.Schema({
${fieldLines}
}, { timestamps: true });

${Model}Schema.index({ createdAt: -1 });

module.exports = mongoose.model("${Model}", ${Model}Schema);
`;
}

function _packageJson(name, port) {
    return JSON.stringify({
        name:    `${name}-api`,
        version: "1.0.0",
        main:    "server.js",
        scripts: { start: "node server.js", dev: "nodemon server.js", test: "jest" },
        dependencies: { express: "^4.18.2", cors: "^2.8.5", mongoose: "^7.5.0", dotenv: "^16.3.1" },
        devDependencies: { nodemon: "^3.0.1", jest: "^29.0.0", supertest: "^6.3.3" }
    }, null, 2);
}

function _envExample(name, port) {
    return `NODE_ENV=development\nPORT=${port}\nMONGO_URI=mongodb://localhost:27017/${name}-db\n`;
}

async function build({ name, outputDir, fields = [], port = 3000 }) {
    if (!name || !outputDir) throw new Error("apiBuilderAgent: name and outputDir are required");

    const files = [
        ["server.js",                                  _serverCode(name, port)],
        [`routes/${name}.js`,                          _routeCode(name)],
        [`controllers/${name}Controller.js`,           _controllerCode(name)],
        [`models/${name}.js`,                          _modelCode(name, fields)],
        ["package.json",                               _packageJson(name, port)],
        [".env.example",                               _envExample(name, port)]
    ];

    const written = [];
    for (const [rel, content] of files) {
        const fullPath = path.join(outputDir, rel);
        await fsUtil.writeFile(fullPath, content);
        written.push({ file: rel, path: fullPath });
    }

    return {
        success:   true,
        api:       name,
        outputDir,
        port,
        files:     written,
        endpoints: [`GET /api/${name}s`, `GET /api/${name}s/:id`, `POST /api/${name}s`, `PUT /api/${name}s/:id`, `DELETE /api/${name}s/:id`],
        start:     `cd ${outputDir} && npm install && npm start`
    };
}

async function run(task) {
    const p = task.payload || {};
    return build({
        name:      p.name      || "resource",
        outputDir: p.outputDir || `./generated/apis/${p.name || "resource"}`,
        fields:    p.fields    || [],
        port:      p.port      || 3000
    });
}

module.exports = { run, build };
