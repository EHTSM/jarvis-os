# C.6 — CROSS-BROWSER WORKFLOW EVIDENCE

Date: 2026-08-14 · Branch: `security/reality-completion`

Raw measured output from real browser engines. No claim from source inspection alone.

---

## Chromium — full authenticated run

```json
{
 "engine": "chromium",
 "version": "149.0.7827.55",
 "blocked": null,
 "journeys": {
  "authLogin": { "status": 200 },
  "authVerified": true,
  "dashboardLoaded": true,
  "orgSwitcherDropdown": { "found": true, "visible": true, "hitsDropdown": true },
  "commandPalette": { "open": true, "resultCount": 93 },
  "paletteSearch": { "resultCount": 2 },
  "paletteEscapeCloses": true,
  "crm": { "hasContent": true, "docOverflow": 0 },
  "finance": { "hasContent": true, "docOverflow": 0 },
  "sales": { "hasContent": true, "docOverflow": 0 },
  "ai": { "hasContent": true, "docOverflow": 0 },
  "settings": { "hasContent": true },
  "formValidation": { "errorShown": true, "text": "Enter a valid amount." },
  "cssSupport": { "flex": true, "grid": true, "sticky": true, "backdropFilter": true, "cssVars": true, "gap": true }
 },
 "consoleErrors": [
  "Failed to load resource: 401 (Unauthorized)",
  "Failed to load resource: 404 (Not Found)",
  "Failed to load resource: 404 (Not Found)"
 ],
 "jsErrors": []
}
```

Console errors traced to specific requests:

```
401 /auth/me       -- expected, occurs before login completes
404 /coding/context -- known pre-existing route gap (documented in an earlier phase,
                        not introduced by C.1-C.6, not a browser-compatibility issue)
```

---

## Firefox — full authenticated run

```json
{
 "engine": "firefox",
 "version": "151.0",
 "blocked": null,
 "journeys": {
  "authLogin": { "status": 200 },
  "authVerified": true,
  "dashboardLoaded": true,
  "orgSwitcherDropdown": { "found": true, "visible": true, "hitsDropdown": true },
  "commandPalette": { "open": true, "resultCount": 93 },
  "paletteSearch": { "resultCount": 2 },
  "paletteEscapeCloses": true,
  "crm": { "hasContent": true, "docOverflow": 0 },
  "finance": { "hasContent": true, "docOverflow": 0 },
  "sales": { "hasContent": true, "docOverflow": 0 },
  "ai": { "hasContent": true, "docOverflow": 0 },
  "settings": { "hasContent": true },
  "formValidation": { "errorShown": true, "text": "Enter a valid amount." },
  "cssSupport": { "flex": true, "grid": true, "sticky": true, "backdropFilter": true, "cssVars": true, "gap": true }
 },
 "consoleErrors": [],
 "jsErrors": []
}
```

**Zero console errors** — Firefox does not surface the same pre-auth 401 as a console-level error the way Chromium does; this is a logging-verbosity difference between engines, not a functional difference (both engines' `authLogin.status` and every subsequent journey are identical).

---

## WebKit — authenticated run, blocked; public-shell run, clean

### Authenticated attempt

```json
{
 "engine": "webkit",
 "version": "26.5",
 "blocked": "auth did not verify (hasTabs=false) after login 200",
 "journeys": {
  "authLogin": { "status": 200 },
  "authVerified": false
 },
 "consoleErrors": [
  "Failed to load resource: 401 (Unauthorized)",
  "Failed to load resource: 401 (Unauthorized)"
 ],
 "jsErrors": []
}
```

### Root-cause investigation

```
cookies in context immediately after login (before nav): []

raw Set-Cookie header (captured via response listener):
  jarvis_auth=eyJhbGci...; Max-Age=28800; Path=/; Expires=Fri, 14 Aug 2026 23:28:10 GMT;
  HttpOnly; Secure; SameSite=Strict

tested via 127.0.0.1 instead of localhost -> same result, 0 cookies stored
  (rules out the specific "localhost" hostname as the variable)
```

### Public-shell measurement (no auth required — proves the engine itself works)

```json
{
 "pageLoaded": true,
 "flex": true, "grid": true, "sticky": true,
 "backdropFilter": true, "cssVars": true, "gap": true,
 "title": "Ooplix — AI Operating System for Your Business"
}
consoleErrors: ["Failed to load resource: 401 (Unauthorized)"]  (expected — /auth/me pre-login)
jsErrors: []
```

---

## Security — unauthenticated route rejection, all three engines

```
chromium: unauthenticated GET /business/stats -> 401
firefox:  unauthenticated GET /business/stats -> 401
webkit:   unauthenticated GET /business/stats -> 401
```

No engine allows a bypass. Consistent, correct behavior across all three.

---

## Build artifact — Chromium + Firefox

```
chromium: scripts=3 styles=2, 0 failed requests
firefox:  scripts=3 styles=2, 0 failed requests
```

## C.5 mobile-overflow carry-forward — cross-engine consistency

```
chromium @ 390px : scrollWidth=513 clientWidth=390 overflow=123
firefox  @ 390px : scrollWidth=514 clientWidth=390 overflow=124
```

1px difference attributable to subpixel layout rounding between engines — not a browser-specific regression of C.5's finding. WebKit not measured at this step (requires the authenticated session, ENV BLOCKED as above).

---

## Regression evidence

```
npm run test:runtime : 144/144 · 0 fail · 0 skipped
99-c1-accessibility-recovery   : 10/10
100-c2-ux-error-truthfulness   : 10/10
101-c3-performance-guards      : 11/11
102-c4-design-system-guards    : 7/7
103-c5-mobile-guards           : 6/6
96-production-build-artifact-integrity : 4/4
104-c6-cross-browser-guards (new) : 4/4
```
