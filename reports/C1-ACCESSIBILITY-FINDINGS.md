# C.1 — ACCESSIBILITY FINDINGS

Date: 2026-08-14 · Branch: `security/reality-completion`

Every finding, with its live evidence and classification.
`FIXED` · `STILL OPEN` · `NOT MEASURED` · `BLOCKED` · `GENUINE GAP` · `FALSE POSITIVE` · `OUT OF SCOPE`

---

## Summary

| Classification | Count |
|---|---:|
| **FIXED** | **5** |
| STILL OPEN | 1 |
| NOT MEASURED | 1 |
| BLOCKED (environment) | 1 |
| FALSE POSITIVE (correctly not "fixed") | 1 |
| OUT OF SCOPE (belongs to a later C phase) | 1 |

---

## C1-D1 — a missing build asset returned 401, not 404 — **FIXED**

**Severity: HIGH.** Blocked the entire C.1 measurement and misdirects production debugging.

`express.static` calls `next()` on a missing file, so the request fell through into the API stack and was answered by authentication:

```
GET /static/js/main.DOESNOTEXIST.js  ->  401 {"error":"Unauthorized"}
GET /static/css/nope.css             ->  401 {"error":"Unauthorized"}
```

**Why it matters beyond the audit.** During a partial or stale deploy, every missing asset reports as an *auth failure*. An operator sees "authentication is broken" and starts debugging sessions, cookies and JWTs, while the real cause is an absent bundle. It also produced the C.1 false reading of `focusable=0` on every route — the SPA could not boot at all.

**Fix.** A 404 boundary for build-asset directories, placed after `express.static` has had its chance. Build assets are public when present, so they must not become auth-gated by being absent.

```
after: /static/js/main.DOESNOTEXIST.js -> 404 {"success":false,"error":"Not Found: GET /static/…",
        "hint":"Static build asset not found — the frontend build may be stale or incomplete."}
       /static/js/main.<real>.js       -> 200 text/javascript
       /                                -> 200 (shell unaffected)
```

Negative-tested: disabling the boundary restored the 401 and the suite failed.

---

## C1-D4 — the server served stale HTML after a redeploy — **FIXED**

**Severity: HIGH.** A blank page for every visitor.

`index.html` was read once and cached for the process lifetime. CRA emits content-hashed bundles, so after any rebuild the still-running server kept serving HTML that referenced deleted files:

```
served by server : main.ee3b42b3.js   main.97d2d73d.css
present on disk  : main.51b4f711.js   main.a205e1a2.css
```

The browser refuses the resulting 404 as a script, so the SPA never mounts. **Every user gets a blank page until someone remembers to restart the process.** Caching headers were already correct (`Cache-Control: no-cache` on the shell) — the staleness was entirely server-side.

**Fix.** Key the cached template on the file's `mtime + size`. Still one read per deploy rather than per request, but a rebuilt `index.html` is picked up automatically.

**Verified with a genuine content change, not an assumption:**

```
served BEFORE : main.51b4f711.js
(edit source; rebuild; NO restart)
served AFTER  : main.4eea5632.js
disk          : main.4eea5632.js
pid unchanged : 6472        <- same process picked up the redeploy
```

An earlier attempt at this test appended a comment, which minification stripped — the hash never changed and the "PASS" proved nothing. It was redone with a real string change.

---

## C1-D2 — first-run modal unreadable in light mode — **FIXED**

**Severity: HIGH.** The first screen a new user sees.

`CustomerFirstRunWizard.css` painted its card through an undefined token with a **dark** hardcoded fallback:

```css
background: var(--surface-elevated, #12131c);   /* --surface-elevated is defined NOWHERE */
```

In light mode the text tokens flip dark, so dark text rendered on a dark card:

```
--text       #1a1f2e on #12131c  =  1.13:1   FAIL (AA needs 4.5:1)
--text-dim   #565f78 on #12131c  =  2.91:1   FAIL
--text-faint #636b86 on #12131c  =  3.50:1   FAIL
```

**Fix.** Use `--surface-float`, the existing theme-aware modal token (white in light, dark in dark). No new token invented.

---

## C1-D3 — destructive confirmation unreadable in light mode — **FIXED**

**Severity: HIGH.** A user could not read what they were confirming.

Same defect class, found by auditing for the *pattern* rather than the instance. `CommandCenter.css`:

```css
.cmd-stop-confirm-panel { background: var(--surface-2, #1a1a2e); }  /* --surface-2 undefined */
```

```
--text     #1a1f2e on #1a1a2e  =  1.04:1   FAIL
--text-dim #565f78 on #1a1a2e  =  2.68:1   FAIL
--danger   #f55b5b on #1a1a2e  =  5.30:1   pass
```

The title of a **destructive stop-confirmation** was invisible in light mode — only the danger icon showed. **Fix:** `--surface-float`, as above.

A repo-wide sweep for the same pattern (undefined token + literal colour fallback) found the remaining matches to be intentional per-instance variables (`--cap-color`, `--op-green`, set inline), not defects.

---

## G1-B193 — placeholder-only controls — **FIXED for the measured surface**

**Severity: HIGH.** Carried forward from B.19.3 and B.25.

A placeholder is not an accessible name under WCAG 3.3.2 — it disappears the moment the user types.

**All 7 distinct unnamed controls in the 5 primary tabs are fixed. Five of them already had visible label text that was never associated** — the human-authored copy existed; only the `htmlFor`/`id` link was missing. The repository's own B19.5 fix on `pv2-template` provided the exact pattern to follow.

| Control | Remedy | Accessible name |
|---|---|---|
| Payments — customer search | `htmlFor`/`id` | "Customer (optional)" |
| Payments — amount | `htmlFor`/`id` | "Amount (₹) *" |
| Payments — description | `htmlFor`/`id` | "Description" |
| Payments — phone | `htmlFor`/`id` | "Phone number" |
| Payments — message | `htmlFor`/`id` | "Message" |
| Contacts — search | `aria-label` (icon-prefixed, no visible label) | "Search contacts by name, phone or service" |
| AI — chat input | `aria-label` | "Message Ooplix" |

The chat input deserves note: its placeholder **changes with state** ("Connecting…", "Ooplix is responding…"), so a screen-reader user would have heard a different field name depending on connection status. `aria-label` gives it one stable name while the placeholder keeps carrying the status hint.

**No label was invented, and no meaningless label was generated.**

Live verification, modal correctly dismissed:

```
[Contacts] 1 control   ok aria-label  Search contacts by name, phone or service
[Payments] 6 controls  ok label-for   Customer (optional) / Amount (₹) * / Description
                                       Phone number / Message template / Message
[AI]       2 controls  ok aria-label  Select AI model / Message Ooplix

NAMED: 9   UNNAMED: 0
```

---

## G1-B193 (remainder) — 82 "More" tabs — **NOT MEASURED**

**STILL OPEN, and honestly unmeasured.**

The live scan covered the 5 primary tabs. A further **82 tabs** exist behind the "More" menu — `EnterpriseOS`, `GrowthOS`, `ContentSEO`, `DeveloperOS`, `BusinessOS` and others — and were not reached. Source analysis bounds the remaining work at roughly **791 bare controls**, concentrated in those families.

That figure is a **source-level bound, not a live measurement**. Based on what the primary tabs showed, a meaningful share likely have adjacent visible labels needing only association — but that is a hypothesis, not a result, and it is not counted as a pass.

**This is why C.1 does not certify 10/10.**

---

## G2-B195 — palette listbox semantics — **FIXED (in B.25), verified holding**

Fixed in B.25 with `role="presentation"` on `.cp-row`. C.1 re-verified: the command palette opens on Cmd+K, focus is trapped inside the dialog, and Escape closes it. `0` axe violations on the palette.

---

## Screen-reader certification — **BLOCKED**

| Reader | Status |
|---|---|
| VoiceOver | present on this macOS host, **NOT running — deliberately not launched** |
| NVDA / Narrator | **NOT AVAILABLE** — Windows only |
| TalkBack | **NOT AVAILABLE** — no Android device attached |

Launching VoiceOver would seize audio and keyboard control of the user's live desktop. The mission forbids that without confirming safety.

**No screen-reader PASS is claimed from DOM inspection. B.19.3's NOT CERTIFIED verdict for screen-reader accessibility stands.**

---

## Skip link flagged by axe — **FALSE POSITIVE, correctly not "fixed"**

axe reported `color-contrast` on `.skip-link` in one scan. Measured directly:

```
white on #6657e8 = 5.13:1   AA normal text (4.5:1): PASS
```

The link sits at `top: -40px` until focused, so axe could not determine the backdrop behind it and flagged it as indeterminate. On a clean page load the violation does not appear at all.

**The element passes AA. Changing it would have been a fabricated fix to satisfy a tool.**

---

## Mobile horizontal scroll — **OUT OF SCOPE (C.2 / C.5)**

At 390 px the document scrolls horizontally (`scrollWidth > innerWidth`). Zero axe violations at that width, and no WCAG AA criterion in the C.1 ruleset is breached (1.4.10 Reflow is AA at 320 px and would need separate assessment).

Recorded here so it is not lost. **It belongs to the Mobile Experience audit (C.5), and C.1 did not expand scope to chase it.**
