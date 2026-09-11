# A.11.1 — Drawer Audit

**Method:** every drawer rendered during the 81-surface authenticated walk was
measured in place; drawer implementations were then read in source.
A.11 marked drawers `NOT MEASURED`; this closes that gap.

---

## Drawer systems found

| System | Files | Kind |
|---|---|---|
| `.ctx-sidebar` | `ContextSidebar.css/.jsx` | persistent context rail |
| `.cv2-drawer` | `ContactsV2.jsx` | overlay detail drawer |
| `.av2-drawer` | `AgentOSV2.jsx` | overlay detail drawer |

Three systems, not a proliferation. **No new drawer system was created.**

---

## Live measurements

| Surface | Drawer | Width | Height | Radius |
|---|---|---:|---:|---:|
| Execution | `ctx-sidebar` | 220px | 1692px | 0 |
| Reliability | `ctx-sidebar` | 220px | 1225px | 0 |
| Jarvis Brain | `ctx-sidebar` | 220px | 905px | 0 |

The persistent rail is **dimensionally consistent** across every surface that
renders it — same width, same radius, same border treatment.

---

## Checklist

| Property | Result | Evidence |
|---|---|---|
| Opening | CONSISTENT | rail is persistent; both overlay drawers open from a row/card click |
| Closing | **FIXED** | see finding D2 |
| Overlay | CONSISTENT | both overlay drawers use `overlayProps` (dismiss on self-click) |
| ESC | **FIXED** | see finding D2 |
| Keyboard focus | CERTIFIED ELSEWHERE | B19.4 recovered focus/keyboard across modals and drawers; suite 28 14/14 |
| Width | CONSISTENT | rail 220px on all three surfaces |
| Header | CONSISTENT | rail carries a bordered header row |
| Close control | CONSISTENT | overlay drawers carry an explicit close; rail is persistent by design |
| Loading | CONSISTENT | inherits the surface's loading state |
| Error | CONSISTENT | inherits the surface's error state |
| Empty state | CONSISTENT | rail renders its own empty copy |
| Scroll behaviour | CONSISTENT | `overflow: hidden` on the rail with inner scroll |
| Nested content | CONSISTENT | no nested-drawer case found |
| Mobile behaviour | **NOT MEASURED** | no drawer rendered on the surfaces reachable at 430/390 |
| Theme | **FIXED** | see finding D1 |
| Action placement | CONSISTENT | actions sit at the drawer foot in both overlay drawers |

---

## Findings

### D1 — `ctx-sidebar` ignored the theme — **FIXED**

**Measured.** `ContextSidebar.css:5` hardcoded `background: #08090e`.

**Class.** Identical to the Global Activity canvas bypass fixed in A.11 (F3′),
and to the ~200-file family removed in B19.2.2 / B19.2.3.

**Impact.** The rail renders on Execution, Reliability and Jarvis Brain — so
three surfaces carried a permanently dark panel regardless of theme.

**Recovered.** `var(--bg)`, the canonical canvas token. No new mechanism.

---

### D2 — `AgentOSV2` drawer was mouse-only — **FIXED**

**Measured.**

```
AgentOSV2.jsx    useEscapeKey: 0   drawer-overlay: 1
ContactsV2.jsx   useEscapeKey: 4   drawer-overlay: 1
```

Two overlay drawers, same job; one bound Escape and one did not. A keyboard user
who opened the AgentOSV2 detail drawer had no way to close it.

**Recovered.** `useEscapeKey(!!drawer, () => setDrawer(null))` — the identical
hook and idiom `ContactsV2` already uses, bound only while the drawer is open.

**Regression.** `tests/runtime/28` (14/14) asserts that every modal/drawer
dismissing on backdrop click also binds Escape.

---

## Verdict

**Drawer consistency: MEASURED — 2 findings, both FIXED.**

One genuine limitation recorded: **mobile drawer behaviour is NOT MEASURED**, because
no drawer-bearing surface was among those reachable at 430/390px during the
responsive slice. That is stated rather than assumed consistent.
