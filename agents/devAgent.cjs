"use strict";
/**
 * Dev Agent — coordinates code generation requests.
 *
 * Two paths:
 *   payload.targetFile set → modifyFile() → proposePatch() → patch proposal (approval required)
 *   no targetFile          → generate()   → new file in /generated/ (existing behaviour)
 */

const path      = require("path");

let _generate         = null;
let _modifyFile       = null;
let _buildRepoContext = null;
let _patchAssist      = null;
try {
    const cga         = require("./dev/codeGeneratorAgent.cjs");
    _generate         = cga.generate;
    _modifyFile       = cga.modifyFile;
    _buildRepoContext  = cga.buildRepoContext;
} catch { /* archived */ }
try { _patchAssist = require("./runtime/patchAssistant.cjs"); } catch { /* unavailable */ }

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

    // ── Path A: modify existing file ─────────────────────────────────────────
    if (p.targetFile) {
        if (!_modifyFile)  return { success: false, error: "devAgent: modifyFile not available" };
        if (!_patchAssist) return { success: false, error: "devAgent: patchAssistant not available" };

        console.log(`[DevAgent] modify mode — target="${p.targetFile}" instruction="${description.slice(0, 80)}"`);

        // Gather repo context before calling AI: imports, importers, keyword files
        let repoCtx = null;
        if (_buildRepoContext) {
            const keyword = p.keyword || description.split(/\s+/).slice(0, 3).join(" ");
            repoCtx = _buildRepoContext(p.targetFile, keyword);
            console.log(`[DevAgent] repo context — scanned ${repoCtx.scannedFiles} files, ${repoCtx.relatedFiles.length} related, ${repoCtx.importers.length} importers`);
        }

        const mod = await _modifyFile({ filePath: p.targetFile, instruction: description, context: repoCtx });
        const proposal = _patchAssist.proposePatch({
            filePath:       mod.filePath,
            patchedContent: mod.patchedContent,
            reason:         description.slice(0, 200),
        });

        if (!proposal.ok) return { success: false, error: proposal.error };

        console.log(`[DevAgent] patch proposed — id=${proposal.patchId} +${proposal.diff.linesAdded}/-${proposal.diff.linesRemoved}`);

        return {
            success:      true,
            type:         "dev_patch",
            result:       `Patch proposed for \`${p.targetFile}\`\n\nPatch ID: \`${proposal.patchId}\`\nLines: ${mod.linesOriginal} → ${mod.linesPatched} (+${proposal.diff.linesAdded}/-${proposal.diff.linesRemoved})\n\nApply:    POST /runtime/patches/${proposal.patchId}/apply  { "approved": true }\nRollback: POST /runtime/patches/${proposal.patchId}/rollback { "approved": true }`,
            patchId:      proposal.patchId,
            targetFile:   mod.filePath,
            diff:         proposal.diff,
            linesOriginal: mod.linesOriginal,
            linesPatched:  mod.linesPatched,
            requiresApproval: true,
            repoContext:  mod.contextUsed,
        };
    }

    // ── Path B: generate new file (original behaviour, unchanged) ────────────
    const framework  = p.framework  || detectFramework(description);
    const filename   = p.filename   || deriveFilename(description, framework);
    const outputPath = p.outputPath || OUTPUT_DIR;

    console.log(`[DevAgent] generate mode — framework="${framework}" filename="${filename}"`);
    console.log(`[DevAgent] generating code for: "${description.slice(0, 80)}"`);

    if (!_generate) return { success: false, error: "devAgent: code generator not available" };
    const result = await _generate({ framework, description, outputPath, filename });

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
