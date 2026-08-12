"use strict";
/**
 * Phase B.19 regression: theme-aware colour on the primary navigation.
 *
 * Reproduced live in a real browser (Chromium via playwright-core) against the
 * running app, in both colour schemes:
 *
 *   .tab                    color: rgba(255,255,255,0.44)  ->  1.04:1 in light mode
 *   .tab.active             color: rgba(255,255,255,0.92)  ->  1.08:1 in light mode
 *   .topbar-nav-arrow       color: rgba(255,255,255,0.35)  ->  1.09:1 in light mode
 *   .topbar-logo-text       color: rgba(255,255,255,0.92)  ->  1.09:1 in light mode
 *
 * WCAG 2.2 AA (1.4.3) requires 4.5:1 for body text. The resting tab state also
 * measured only 4.31:1 in DARK mode — marginally under AA even there.
 *
 * The theme system itself was never broken: index.css defines --text and
 * --text-dim and correctly flips both for [data-theme="light"] and for
 * prefers-color-scheme (#dde2ec -> #1a1f2e, #8994b0 -> #565f78). These rules
 * simply bypassed it with hardcoded white. Using the existing tokens measures
 * 5.83:1 light / 6.64:1 dark at rest and 15.06:1 / 15.50:1 active.
 *
 * Also fixed: the tabs rendered 23px tall (5px vertical padding), one pixel
 * under the WCAG 2.2 AA 2.5.8 minimum of 24px.
 *
 * Recovery only — existing CSS variables, no new theme layer, no redesign.
 * Verified in the built bundle: nav-tab contrast failures dropped 5 -> 1 and
 * topbar-arrow failures 3 -> 0 on the live page, targets below 24px 17 -> 11.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");

const ROOT    = path.join(__dirname, "../..");
const APP_CSS = path.join(ROOT, "frontend/src/App.css");
const IDX_CSS = path.join(ROOT, "frontend/src/index.css");

const read = p => fs.readFileSync(p, "utf8");

/** Relative luminance per WCAG 2.x. */
function luminance([r, g, b]) {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const [R, G, B] = [f(r), f(g), f(b)];
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
function contrast(a, b) {
    const L1 = luminance(a), L2 = luminance(b);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}
const hex = h => {
    h = h.replace("#", "");
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
};
/** Extract a CSS custom property value from a given rule block. */
function cssVar(src, blockSelector, name) {
    const i = src.indexOf(blockSelector);
    assert.ok(i !== -1, `${blockSelector} must exist in index.css`);
    const block = src.slice(i, src.indexOf("}", i));
    const m = block.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`));
    return m ? m[1] : null;
}
/**
 * Isolate a rule body by its exact selector.
 *
 * Scans selector lists rather than pattern-matching the file, so `.tab` cannot
 * accidentally match `.tab-more`, `.tab--featured`, or a rule that happens to be
 * preceded by a comment instead of a closing brace.
 */
function rule(src, selector) {
    // Strip comments first so a `*/` inside an explanatory block cannot be
    // mistaken for a selector boundary, then walk brace pairs.
    const clean = src.replace(/\/\*[\s\S]*?\*\//g, "");
    let i = 0, prevClose = 0;
    while (i < clean.length) {
        const open = clean.indexOf("{", i);
        if (open === -1) return null;
        const close = clean.indexOf("}", open);
        if (close === -1) return null;
        const selectors = clean.slice(prevClose, open).split(",").map(s => s.trim()).filter(Boolean);
        if (selectors.includes(selector)) return clean.slice(open + 1, close);
        i = close + 1;
        prevClose = close + 1;
    }
    return null;
}

describe("accessibility: theme-aware navigation colour (Phase B.19)", () => {
    it("the light-mode theme tokens themselves meet WCAG AA", () => {
        const idx = read(IDX_CSS);
        const bg   = cssVar(idx, ':root[data-theme="light"]', "--bg");
        const text = cssVar(idx, ':root[data-theme="light"]', "--text");
        const dim  = cssVar(idx, ':root[data-theme="light"]', "--text-dim");
        assert.ok(bg && text && dim, "light theme must define --bg, --text and --text-dim");

        const textRatio = contrast(hex(text), hex(bg));
        const dimRatio  = contrast(hex(dim), hex(bg));
        assert.ok(textRatio >= 4.5, `--text on --bg must meet AA, got ${textRatio.toFixed(2)}:1`);
        assert.ok(dimRatio  >= 4.5, `--text-dim on --bg must meet AA, got ${dimRatio.toFixed(2)}:1`);
    });

    it("the dark-mode theme tokens meet WCAG AA too", () => {
        const idx = read(IDX_CSS);
        const bg   = cssVar(idx, ":root {", "--bg") || cssVar(idx, ":root{", "--bg");
        const text = cssVar(idx, ":root {", "--text") || cssVar(idx, ":root{", "--text");
        const dim  = cssVar(idx, ":root {", "--text-dim") || cssVar(idx, ":root{", "--text-dim");
        assert.ok(bg && text && dim, "the default (dark) theme must define the tokens");
        assert.ok(contrast(hex(text), hex(bg)) >= 4.5,
            "--text on --bg must meet AA in dark mode");
        assert.ok(contrast(hex(dim), hex(bg)) >= 4.5,
            "--text-dim on --bg must meet AA in dark mode");
    });

    /* B19.2.2: these assert the OUTCOME (the colour follows the theme), not one
       particular spelling of it. Two mechanisms are valid:
         • a --text* token                     (semantic text roles)
         • rgba(var(--fg-rgb), α)              (dimmed chrome foreground)
       Both invert with the theme; hardcoded white does not. */
    const THEME_AWARE_FG = /color:\s*(var\(--text|rgba\(\s*var\(--fg-rgb\))/;

    it("the nav tab uses a theme-aware colour, not hardcoded white", () => {
        const body = rule(read(APP_CSS), ".tab");
        assert.ok(body, ".tab rule must exist");
        assert.ok(THEME_AWARE_FG.test(body),
            ".tab must take its colour from a token or --fg-rgb so it follows the theme");
        assert.ok(!/color:\s*rgba\(255,\s*255,\s*255/.test(body),
            ".tab must not hardcode white — it measured 1.04:1 in light mode");
    });

    it("the active and hover tab states are theme-aware", () => {
        const src = read(APP_CSS);
        for (const sel of [".tab.active", ".tab:hover"]) {
            const body = rule(src, sel);
            assert.ok(body, `${sel} rule must exist`);
            assert.ok(!/color:\s*rgba\(255,\s*255,\s*255/.test(body),
                `${sel} must not hardcode white text`);
            assert.ok(THEME_AWARE_FG.test(body),
                `${sel} must use a --text* token or --fg-rgb`);
        }
    });

    it("the tab meets the WCAG 2.5.8 AA 24px target minimum", () => {
        const body = rule(read(APP_CSS), ".tab");
        assert.ok(/min-height:\s*24px/.test(body),
            ".tab must guarantee a 24px target height (it rendered 23px before)");
        const pad = body.match(/padding:\s*(\d+)px/);
        assert.ok(pad && Number(pad[1]) >= 6,
            "vertical padding must be at least 6px so the rendered height reaches 24px");
    });

    it("the topbar navigation arrows and logo are theme-aware", () => {
        const src = read(APP_CSS);
        const arrow = rule(src, ".topbar-nav-arrow");
        assert.ok(arrow, ".topbar-nav-arrow rule must exist");
        assert.ok(THEME_AWARE_FG.test(arrow),
            ".topbar-nav-arrow measured 1.09:1 in light mode with hardcoded white");

        const logo = rule(src, ".topbar-logo-text");
        assert.ok(logo, ".topbar-logo-text rule must exist");
        assert.ok(THEME_AWARE_FG.test(logo),
            ".topbar-logo-text must follow the theme");
    });

    it("hover states do not reintroduce a hardcoded white background", () => {
        const src = read(APP_CSS);
        const hover = rule(src, ".topbar-nav-arrow:hover:not(:disabled)");
        if (hover) {
            assert.ok(!/color:\s*rgba\(255,\s*255,\s*255/.test(hover),
                "the hover colour must be theme-aware too");
        }
    });

    it("the light theme is still activated by both explicit choice and OS preference", () => {
        // The fix relies on these existing switches; if either is removed the
        // tokens stop flipping and the tabs silently fail again.
        const idx = read(IDX_CSS);
        assert.ok(idx.includes(':root[data-theme="light"]'),
            "explicit light theme selector must remain");
        assert.ok(/@media\s*\(prefers-color-scheme:\s*light\)/.test(idx),
            "OS-preference light theme must remain");
        assert.ok(/:root:not\(\[data-theme\]\)/.test(idx),
            "the OS-preference block must only apply when no explicit choice was persisted");
    });

    it("no theme-critical variable used by the fix is undefined", () => {
        const idx = read(IDX_CSS);
        for (const v of ["--text", "--text-dim", "--bg", "--border"]) {
            assert.ok(idx.includes(`${v}:`), `${v} must be defined in index.css`);
        }
    });
});
