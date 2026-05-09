"use strict";
/**
 * Dev Agent — coordinates code generation requests.
 * Detects framework, derives filename, calls codeGeneratorAgent,
 * writes output to /generated/, returns structured result.
 */

const path      = require("path");
const { generate } = require("./dev/codeGeneratorAgent.cjs");

const OUTPUT_DIR = path.join(__dirname, "../generated");

const FRAMEWORK_PATTERNS = [
    { pattern: /\bexpress\b/i,              framework: "express" },
    { pattern: /\breact\b|\bcomponent\b/i,  framework: "react"   },
    { pattern: /\bapi\b|\brest\b/i,         framework: "api"     },
    { pattern: /\bnode\b|\bserver\b/i,      framework: "node"    },
    { pattern: /\butility\b|\bhelper\b/i,   framework: "utility" },
];

const FILE_EXT = {
    express: ".js",
    react:   ".jsx",
    api:     ".js",
    node:    ".js",
    utility: ".js",
};

function detectFramework(description) {
    for (const { pattern, framework } of FRAMEWORK_PATTERNS) {
        if (pattern.test(description)) return framework;
    }
    return "node";
}

function deriveFilename(description, framework) {
    // Extract meaningful words, skip stop words
    const stop = new Set(["a","an","the","simple","basic","small","create","make","build","generate","write","new","with","for","that","and","or","using"]);
    const words = description
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter(w => w.length > 2 && !stop.has(w))
        .slice(0, 3);
    const base = words.join("-") || "generated-file";
    return `${base}${FILE_EXT[framework] || ".js"}`;
}

async function run(task) {
    const p           = task.payload || {};
    const description = p.description || task.input || "";

    if (!description.trim()) {
        return { success: false, error: "devAgent: description is required" };
    }

    const framework = p.framework || detectFramework(description);
    const filename  = p.filename  || deriveFilename(description, framework);
    const outputPath = p.outputPath || OUTPUT_DIR;

    console.log(`[DevAgent] framework="${framework}" filename="${filename}" outputPath="${outputPath}"`);
    console.log(`[DevAgent] generating code for: "${description.slice(0, 80)}"`);

    const result = await generate({ framework, description, outputPath, filename });

    if (result.written) {
        console.log(`[DevAgent] file written → ${result.written.path} (${result.written.bytes} bytes)`);
    }

    const filePath = result.written?.path || null;
    const reply = filePath
        ? `Generated \`${filename}\` (${result.lines} lines, ${result.written.bytes} bytes)\n\nSaved to: ${filePath}\n\n\`\`\`${framework}\n${result.code.slice(0, 2000)}${result.code.length > 2000 ? "\n// ... (truncated)" : ""}\n\`\`\``
        : `Generated code:\n\n\`\`\`${framework}\n${result.code.slice(0, 2000)}\n\`\`\``;

    return {
        success:     true,
        type:        "dev",
        result:      reply,
        framework,
        filename,
        path:        filePath,
        bytes:       result.written?.bytes || 0,
        lines:       result.lines,
        description,
        code:        result.code,
    };
}

module.exports = { run };
