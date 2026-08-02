"use strict";
/**
 * Document Export Renderer — turns an already-computed JS report object
 * into real DOCX or PPTX bytes.
 *
 * Enterprise Capability Expansion mission: DOCX/PPTX export were both
 * "Not Supported" in the prior audit. This does not invent new report
 * content — it renders the SAME report objects the JSON endpoints already
 * return (e.g. founderJournal.cjs's getFullReport()), so DOCX/PPTX export
 * is a pure serialization step, not a new content-generation feature.
 *
 * Deliberately generic (title + ordered sections of key/value or list data)
 * so any existing "report"-shaped object in the codebase (pcpReport.cjs,
 * op2Report.cjs, pipReport.cjs, launchReadiness.cjs) can reuse the same
 * renderer without a bespoke exporter per module.
 */

const {
    Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell, WidthType,
} = require("docx");
const PptxGenJS = require("pptxgenjs");

function _flatten(value, depth = 0) {
    // Turns any JSON-ish value into readable lines for a document body.
    if (value === null || value === undefined) return ["—"];
    if (Array.isArray(value)) {
        if (!value.length) return ["(none)"];
        return value.flatMap(v => (typeof v === "object" ? _flatten(v, depth) : [`• ${String(v)}`]));
    }
    if (typeof value === "object") {
        return Object.entries(value).flatMap(([k, v]) => {
            if (v !== null && typeof v === "object") {
                return [`${k}:`, ..._flatten(v, depth + 1).map(l => `  ${l}`)];
            }
            return [`${k}: ${String(v)}`];
        });
    }
    return [String(value)];
}

function _toSections(report) {
    // report is a plain object whose top-level keys are report sections
    // (this is exactly the shape getFullReport() and similar functions
    // already return — no transformation of the source data happens here).
    return Object.entries(report || {}).map(([title, body]) => ({
        title,
        lines: _flatten(body),
    }));
}

/**
 * renderDocx({ title, report }) -> Buffer (real .docx bytes)
 */
async function renderDocx({ title, report }) {
    const sections = _toSections(report);
    const children = [
        new Paragraph({ text: title || "Report", heading: HeadingLevel.TITLE }),
        new Paragraph({ text: `Generated ${new Date().toISOString()}`, spacing: { after: 300 } }),
    ];
    for (const sec of sections) {
        children.push(new Paragraph({ text: sec.title, heading: HeadingLevel.HEADING_1 }));
        for (const line of sec.lines) {
            children.push(new Paragraph({ children: [new TextRun(line)] }));
        }
    }
    const doc = new Document({ sections: [{ children }] });
    return Packer.toBuffer(doc);
}

/**
 * renderPptx({ title, report }) -> Buffer (real .pptx bytes)
 * One title slide + one slide per top-level report section (bullet lines,
 * truncated/paginated if a section has a lot of lines so text stays
 * readable rather than overflowing the slide).
 */
async function renderPptx({ title, report }) {
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: "JARVIS", width: 10, height: 5.625 });
    pptx.layout = "JARVIS";

    const cover = pptx.addSlide();
    cover.addText(title || "Report", { x: 0.5, y: 2, w: 9, h: 1, fontSize: 32, bold: true });
    cover.addText(`Generated ${new Date().toISOString()}`, { x: 0.5, y: 3, w: 9, h: 0.5, fontSize: 14, color: "666666" });

    const sections = _toSections(report);
    const LINES_PER_SLIDE = 14;
    for (const sec of sections) {
        for (let i = 0; i < Math.max(sec.lines.length, 1); i += LINES_PER_SLIDE) {
            const chunk = sec.lines.slice(i, i + LINES_PER_SLIDE);
            const slide = pptx.addSlide();
            slide.addText(sec.title + (i > 0 ? " (cont.)" : ""), { x: 0.4, y: 0.3, w: 9.2, h: 0.6, fontSize: 22, bold: true });
            slide.addText(chunk.map(l => ({ text: l, options: { bullet: true, breakLine: true } })), {
                x: 0.5, y: 1.1, w: 9, h: 4.2, fontSize: 14, valign: "top",
            });
        }
    }
    return pptx.write({ outputType: "nodebuffer" });
}

module.exports = { renderDocx, renderPptx };
