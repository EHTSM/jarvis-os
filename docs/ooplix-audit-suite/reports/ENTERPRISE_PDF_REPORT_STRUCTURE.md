# OOPLIX V1 — Enterprise PDF Report Structure

**Document ID:** OPX-RPT-001 · **Target length:** 78–92 pages · **Format:** A4 portrait, 20 mm margins
**Build:** `scripts/build-pdf.js` (Markdown → HTML → PDF via the project's existing `playwright-core`; no new dependency)

---

## Document Control Block (page ii)

| Field | Value |
|---|---|
| Document ID | OPX-RPT-001 |
| Title | Ooplix V1 Master Audit & Certification Report |
| Version | 1.0.0 |
| Date of record | 2026-08-09 |
| Product | Ooplix (`jarvis-os`) v1.0.0-rc1 |
| Branch of record | `security/reality-completion` |
| Classification | Confidential — Investor / Enterprise Due Diligence |
| Retention | Permanent — certification record |
| Supersedes | None (initial issue) |
| Review cycle | On execution of any PLANNED audit |

**Approval table** (unsigned in this issue — intentionally, since no approval has occurred):

| Role | Name | Signature | Date |
|---|---|---|---|
| Audit lead | — | — | — |
| Engineering owner | — | — | — |
| Executive sponsor | — | — | — |

> Leave these blank rather than pre-filling. An unsigned control block is honest; a fabricated one voids the document.

---

## Front Matter

| Page | Section | Content |
|---|---|---|
| i | Cover | Title, product version, date, classification band. No imagery. |
| ii | Document control | Table above + approval block |
| iii | **Statement of Evidence Integrity** | The 35-executed / 7-planned split, stated before anything else |
| iv–v | Table of contents | Auto-generated, 3 levels |
| vi | Table of figures | 12 figures |
| vii | Table of tables | 24 tables |
| viii | Definitions & abbreviations | Verdict model, severity model, gap vs defect, layer definitions |
| ix | Reading guide | How to verify any claim in the document |

**Note on page iii.** The evidence-integrity statement precedes the executive summary deliberately. A reader who stops after two pages must still leave knowing which parts are measured and which are forecast.

---

## Part 1 — Executive Summary (pages 1–8)

| § | Title | Pages | Content |
|---|---|---|---|
| 1.1 | Position statement | 1 | Three paragraphs: what was audited, what was found, what remains open |
| 1.2 | Headline figures | 1 | 31 executed · 116 findings · 17 critical recovered · 3 residual critical · mean 8.49/10 |
| 1.3 | Verdict distribution | 1 | 15 / 15 / 1 with the NOT CERTIFIED audit named on the same page |
| 1.4 | The three critical gaps | 2 | One root cause, three symptoms, remediation programme summary |
| 1.5 | What is strong | 1 | Runtime integrity, boundary security, recovery, AI honesty — with figures |
| 1.6 | What is weak | 1 | Tenant ownership, accessibility, API surface — with figures |
| 1.7 | Recommendation | 1 | Conditional readiness statement with explicit conditions |

**§1.7 must not read "GO".** The honest formulation is a conditional: production readiness for the certified surfaces, with the three critical gaps as named conditions on multi-tenant support and customer-operations workloads.

---

## Part 2 — Audit Method (pages 9–18)

| § | Title | Pages |
|---|---|---|
| 2.1 | The six-step protocol | 2 |
| 2.2 | Constraint 1 — measure before reading source | 2 |
| 2.3 | Constraint 2 — recover, do not construct | 2 |
| 2.4 | Constraint 3 — real tenants, real failures | 2 |
| 2.5 | Constraint 4 — negative-tested regressions | 1 |
| 2.6 | **Limitations of this method** | 1 |

**§2.6 is mandatory.** Lists what the record cannot tell you: no screen-reader runtime, Blink-only browser coverage, no axe-core scan, credential-blocked live payments, no sustained-load capacity data.

---

## Part 3 — Programme Structure (pages 19–26)

| § | Title | Pages |
|---|---|---|
| 3.1 | Six-layer model | 2 |
| 3.2 | Layer dependency rationale | 2 |
| 3.3 | Timeline and Gantt | 2 |
| 3.4 | Planned audits and entry criteria | 2 |

---

## Part 4 — Master Audit Register (pages 27–44)

Full reproduction of `register/MASTER_AUDIT_REGISTER.md`, one page per layer group plus the register tables.

| § | Title | Pages |
|---|---|---|
| 4.1 | Register conventions | 1 |
| 4.2 | Layer 1 — Foundation (A.1–A.6) | 3 |
| 4.3 | Layer 2 — Engineering (A.7–B.1) | 4 |
| 4.4 | Layer 3 — Intelligence (B.9–B.12) | 3 |
| 4.5 | Layer 4 — Operations (B.4–B.19) | 6 |
| 4.6 | Layers 5–6 — Planned (B.20–C) | 1 |

Each audit entry uses a fixed block: **ID · Title · Date · Verdict · Score · Scope · Findings by severity · Headline · Evidence reference.**

---

## Part 5 — Findings Detail (pages 45–62)

One page per significant finding, fixed structure:

> **Finding ID · Severity · Title**
> **Reproduction** — exact steps and observed result
> **Measurement** — the table of measured values
> **Root cause** — file and line reference
> **Recovery** — what changed, with diff scope
> **Regression** — test added, negative-test result
> **Reverification** — re-measured outcome

Covers the 17 critical findings in full and the 6 highest-impact high-severity findings.

---

## Part 6 — Residual Gap Register (pages 63–70)

| § | Title | Pages |
|---|---|---|
| 6.1 | Gap vs defect — the distinction | 1 |
| 6.2 | The three critical gaps in full | 3 |
| 6.3 | High and medium gaps | 2 |
| 6.4 | Remediation programme R1–R3 | 2 |

**§6.1 defines the distinction that governs the document:** a defect is a broken capability that exists; a gap is a capability that was never built. Defects were recovered. Gaps were recorded.

---

## Part 7 — Scorecards & Maturity (pages 71–78)

| § | Title | Pages |
|---|---|---|
| 7.1 | Scoring methodology and its limits | 1 |
| 7.2 | Dimension scorecards — B.7, B.9, B.10, B.11, B.19 | 4 |
| 7.3 | Maturity model and current position | 2 |
| 7.4 | Why 29 audits carry no score | 1 |

**§7.4 matters.** Only 6 of 36 executed audits produced weighted dimension scores; the rest were pass/fail against defined criteria. Averaging across both would fabricate precision.

---

## Part 8 — Roadmap to Certification (pages 79–86)

| § | Title | Pages |
|---|---|---|
| 8.1 | Certification gates 0–5 | 2 |
| 8.2 | Critical path | 2 |
| 8.3 | Entry criteria traceability | 2 |
| 8.4 | Phase C requirements | 2 |

**§8.3** provides the traceability matrix: every entry criterion mapped to the measured finding that produced it.

---

## Appendices (pages 87–92)

| Appendix | Content |
|---|---|
| A | Complete gap register — all 92 gaps |
| B | Evidence index — every artifact and commit |
| C | Regression suite inventory |
| D | Measured-figures index — every number in the report with its source |
| E | Glossary |
| F | Verification instructions — how a third party reproduces any claim |

**Appendix D is the diligence appendix.** A single table listing every quantitative claim in the document alongside its source phase and artifact. It exists so a reviewer can spot-check without reading linearly.

---

## Typographic Specification

| Element | Spec |
|---|---|
| Body | 10.5 pt / 15 pt leading, serif |
| Headings | Sans-serif, 600 weight; H1 20 pt, H2 15 pt, H3 12 pt |
| Tables | 9.5 pt, zebra `#F5F8FA`, 0.5 pt rules `#D8E0E7` |
| Measured values | Monospace, to distinguish measurement from prose |
| Severity | CRITICAL `#B00020` · HIGH `#C55A11` · MEDIUM `#BF9000` · LOW `#4A5C6D` |
| PLANNED content | `#8A96A3`, dashed rules — visually distinct at a glance |
| Page furniture | Header: document ID + section. Footer: page n of m + classification |

**Rule:** a PLANNED row must remain visually distinguishable in greyscale print. Colour alone is not sufficient — use the dashed rule.
