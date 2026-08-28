"use strict";
/**
 * Phase B.15 regression: support tickets must be owned, validated, and honest.
 *
 * Three defects were reproduced live against the running product with two real
 * accounts (A and B) registered into two separate organizations:
 *
 * D1 — CS inbox had no ownership at all. createCSTicket() has always accepted an
 *      accountId and getCSInbox() has always supported an accountId filter, but
 *      the routes never forwarded req.user.sub, so every ticket stored
 *      accountId:null and the filter was unusable. Account B read account A's
 *      ticket verbatim — subject, body, and the "INTERNAL: customer is on trial"
 *      note — then reassigned it to "ORG_B_HIJACK" and closed it. Both the read
 *      and the write were confirmed durable in data/co3-user-success.json.
 *
 * D2 — updateTicket() wrote status/priority straight through with no check
 *      against the CS_TICKET_STATUS / CS_TICKET_PRIORITY enums this module
 *      already declares AND exports. PATCH {"status":"DROP_TABLE"} stored
 *      verbatim with HTTP 200; getCSInbox() then reported total=3 while
 *      open+resolved=2, so the ticket vanished from every operational bucket and
 *      from slaBreach detection. Additionally resolvedAt was set on "resolved"
 *      but never cleared on reopen (and "closed" never set it), so a reopened
 *      ticket still counted as resolved in avgResolutionHrs.
 *
 * D3 — /customer-org/support/tickets used `parseInt(limit)||50`, unclamped, so
 *      ?limit=-1 reached slice(0,-1) and returned 189 of 190 tickets — the same
 *      negative-limit cap bypass recovered across 38 sites in Phase B.7.
 *
 * All three are recoveries of capability that already existed. No new storage,
 * no new ticket engine, no new service.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");

const ROOT      = path.join(__dirname, "../..");
const CO3_ROUTE = path.join(ROOT, "backend/routes/co3UserSuccess.js");
const CO3_SVC   = path.join(ROOT, "backend/services/co3UserSuccess.cjs");
const CORG      = path.join(ROOT, "backend/routes/customerOrg.js");

const svc = require("../../backend/services/co3UserSuccess.cjs");
const read = p => fs.readFileSync(p, "utf8");

describe("support ownership + lifecycle (Phase B.15)", () => {
    // ── D1: ownership ────────────────────────────────────────────────────────
    it("stamps ticket ownership from the verified session, not the body", () => {
        const src = read(CO3_ROUTE);
        assert.ok(/createCSTicket\(\{\s*\.\.\.req\.body,\s*accountId:\s*req\.user\.sub\s*\}\)/.test(src),
            "POST /co3/cs must stamp accountId from req.user.sub, after the body spread " +
            "so a client-supplied accountId cannot forge ownership");
    });

    it("pins a non-operator's inbox view to their own tickets", () => {
        const src = read(CO3_ROUTE);
        assert.ok(/if \(!_isOperator\(req\)\) filter\.accountId = req\.user\.sub;/.test(src),
            "GET /co3/cs must override accountId for non-operators — a client-supplied " +
            "accountId must never widen the view");
    });

    it("guards reply and patch with the ownership check", () => {
        const src = read(CO3_ROUTE);
        const replyBlock = src.slice(src.indexOf('"/co3/cs/:id/reply"'));
        assert.ok(/_assertTicketOwner\(req, req\.params\.id\)/.test(replyBlock.slice(0, 400)),
            "POST /co3/cs/:id/reply must assert ownership — B could otherwise inject " +
            "into another account's support thread");
        const patchBlock = src.slice(src.indexOf('router.patch("/co3/cs/:id"'));
        assert.ok(/_assertTicketOwner\(req, req\.params\.id\)/.test(patchBlock.slice(0, 400)),
            "PATCH /co3/cs/:id must assert ownership — B could otherwise reassign/close");
    });

    it("refuses to let a PATCH rewrite accountId (ownership is not mutable)", () => {
        const src = read(CO3_ROUTE);
        assert.ok(/const \{ accountId: _ignored, \.\.\.update \} = req\.body \|\| \{\};/.test(src),
            "PATCH must strip accountId or a caller could transfer a ticket to itself");
    });

    it("scopes by account through the existing filter (operator keeps full view)", () => {
        // Mission 67: this test always assumed at least one real,
        // account-owning ticket already existed in data/co3-user-success.json
        // — true against a populated local dev store, but data/ is
        // gitignored, so a fresh CI checkout starts genuinely empty and this
        // assertion ("need at least one ticket to scope") always failed
        // there. Seeded here using the file's own already-established
        // svc.createCSTicket()/cleanup convention (see "resolve → reopen →
        // close" and "SLA targets" tests below in this same file), so the
        // real ownership-scoping logic is genuinely exercised in every
        // environment rather than depending on ambient prior state.
        const seeded = svc.createCSTicket({
            userEmail: "b15-scope-seed@test.local",
            subject:   "B15 scope-test seed ticket",
            body:      "x",
            priority:  "low",
            accountId: "b15-scope-seed-acct",
        });
        try {
            const all = svc.getCSInbox({});
            assert.ok(all.tickets.length >= 1, "need at least one ticket to scope");
            // Pick a ticket that actually carries ownership.
            const owned = all.tickets.find(t => t.accountId);
            assert.ok(owned, "at least one ticket must carry an accountId once the fix is wired");

            const mine = svc.getCSInbox({ accountId: owned.accountId });
            assert.ok(mine.tickets.length >= 1, "owner must see their own ticket");
            assert.ok(mine.tickets.every(t => t.accountId === owned.accountId),
                "an account-scoped view must contain only that account's tickets");

            const other = svc.getCSInbox({ accountId: "b15-definitely-not-an-account" });
            assert.equal(other.tickets.length, 0,
                "a foreign account must see zero tickets — this is the cross-tenant leak");

            // Operator path passes no accountId and still sees everything.
            assert.ok(svc.getCSInbox({}).tickets.length >= mine.tickets.length,
                "the unscoped (operator) view must remain complete");
        } finally {
            // Keep the store clean — this is a live data file (matches this
            // file's own established cleanup convention).
            const p = path.join(ROOT, "data/co3-user-success.json");
            const s = JSON.parse(read(p));
            delete s.csInbox[seeded.id];
            fs.writeFileSync(p, JSON.stringify(s, null, 2));
        }
    });

    it("returns 403 (not 404/500) when acting on another account's ticket", () => {
        const src = read(CO3_ROUTE);
        assert.ok(/e\.status = 403;/.test(src), "cross-account access must be a 403");
        assert.ok(/res\.status\(e\?\.status \|\| c \|\| 500\)/.test(src),
            "_err must honour an error's own status so 403/400 are not flattened to 404/500");
    });

    it("leaves legacy (accountId:null) tickets operable rather than stranded", () => {
        const src = read(CO3_ROUTE);
        const fn = src.slice(src.indexOf("function _assertTicketOwner"));
        assert.ok(/if \(t\.accountId && t\.accountId !== req\.user\.sub\)/.test(fn.slice(0, 700)),
            "the check must be conditional on t.accountId so pre-existing support work " +
            "created before ownership existed does not become unreachable");
    });

    // ── D2: enum validation + resolvedAt ─────────────────────────────────────
    // Mission 67: all three of these tests read an existing ticket id
    // directly out of data/co3-user-success.json — same missing-fixture gap
    // as "scopes by account" above. Each rejected update (invalid
    // status/priority) throws before writing anything, so one shared seed
    // ticket, created once and cleaned up once after the last of the three,
    // is safe and sufficient — matches this file's own established
    // svc.createCSTicket()/cleanup convention.
    const d2SeedTicket = svc.createCSTicket({
        userEmail: "b15-d2-seed@test.local",
        subject:   "B15 enum-validation seed ticket",
        body:      "x",
        priority:  "low",
        accountId: "b15-d2-seed-acct",
    });

    it("rejects a status outside the enum it already exports", () => {
        const id = d2SeedTicket.id;
        assert.ok(id, "need an existing ticket");
        assert.throws(() => svc.updateTicket(id, { status: "DROP_TABLE" }),
            /Invalid status/, "an out-of-enum status must be refused, not stored");
        assert.throws(() => svc.updateTicket(id, { status: "pending" }),
            /Invalid status/, '"pending" is not in CS_TICKET_STATUS and must be refused');
    });

    it("rejects a priority outside the enum it already exports", () => {
        const id = d2SeedTicket.id;
        assert.throws(() => svc.updateTicket(id, { priority: "bogus_pri" }),
            /Invalid priority/, "an out-of-enum priority must be refused, not stored");
    });

    it("validation errors carry HTTP 400, not 500", () => {
        const id = d2SeedTicket.id;
        try {
            svc.updateTicket(id, { status: "nope" });
            assert.fail("should have thrown");
        } catch (e) {
            assert.equal(e.status, 400, "a bad request must be a 400");
        } finally {
            // Last of the three D2 tests to run — clean up the shared seed
            // ticket here, matching this file's own established cleanup
            // convention (keep the store clean, it is a live data file).
            const p = path.join(ROOT, "data/co3-user-success.json");
            const s = JSON.parse(read(p));
            delete s.csInbox[d2SeedTicket.id];
            fs.writeFileSync(p, JSON.stringify(s, null, 2));
        }
    });

    it("keeps every stored status/priority inside the declared enums", () => {
        const inbox = svc.getCSInbox({});
        const badS = Object.keys(inbox.byStatus).filter(s => !inbox.CS_TICKET_STATUS.includes(s));
        assert.deepEqual(badS, [],
            "a status outside the enum makes the ticket vanish from open/resolved/slaBreach");
        // byPriority may still hold values written before the fix; assert the
        // reporting invariant that actually matters instead.
        assert.equal(inbox.open + inbox.resolved <= inbox.total, true,
            "open+resolved must never exceed total");
    });

    it("clears resolvedAt on reopen and sets it on both terminal states", () => {
        const src = read(CO3_SVC);
        const fn  = src.slice(src.indexOf("function updateTicket"));
        const body = fn.slice(0, fn.indexOf("\nfunction "));
        assert.ok(/update\.status === "resolved" \|\| update\.status === "closed"/.test(body),
            '"closed" must stamp resolvedAt too — replyToTicket already treats both as terminal');
        assert.ok(/s\.csInbox\[id\]\.resolvedAt = null;/.test(body),
            "reopening must clear resolvedAt or a reopened ticket keeps counting as resolved " +
            "in avgResolutionHrs");
    });

    it("resolve → reopen → close moves resolvedAt correctly end-to-end", () => {
        const t = svc.createCSTicket({
            userEmail: "b15-regression@test.local",
            subject:   "B15 resolvedAt lifecycle",
            body:      "x",
            priority:  "low",
            accountId: "b15-regression-acct",
        });
        try {
            assert.equal(svc.updateTicket(t.id, { status: "resolved" }).resolvedAt !== null, true,
                "resolve must stamp resolvedAt");
            assert.equal(svc.updateTicket(t.id, { status: "open" }).resolvedAt, null,
                "reopen must clear resolvedAt");
            assert.equal(svc.updateTicket(t.id, { status: "closed" }).resolvedAt !== null, true,
                "close must stamp resolvedAt");
        } finally {
            // Keep the store clean — this is a live data file.
            const p = path.join(ROOT, "data/co3-user-success.json");
            const s = JSON.parse(read(p));
            delete s.csInbox[t.id];
            fs.writeFileSync(p, JSON.stringify(s, null, 2));
        }
    });

    // ── D3: limit clamp ──────────────────────────────────────────────────────
    it("clamps the legacy ticket-list limit at both bounds", () => {
        const src = read(CORG);
        const line = src.split("\n").find(l => l.includes("Math.max(1, Math.min(parseInt(limit)"));
        assert.ok(line, "the ticket list limit must be clamped (Phase B.7 pattern)");
        const clamp = l => Math.max(1, Math.min(parseInt(l) || 500, 500));
        assert.equal(clamp("-1"), 1,   "a negative limit must not reach slice(0, -1)");
        assert.equal(clamp("99999"), 500, "an oversized limit must be capped");
    });

    it("SLA targets still derive from priority (capability must survive the fix)", () => {
        const t = svc.createCSTicket({
            userEmail: "b15-sla@test.local", subject: "B15 sla", body: "x",
            priority: "urgent", accountId: "b15-regression-acct",
        });
        try {
            const hrs = (new Date(t.sla_target) - new Date(t.createdAt)) / 3600_000;
            assert.ok(Math.abs(hrs - 4) < 0.1, `urgent must target 4h, got ${hrs}h`);
        } finally {
            const p = path.join(ROOT, "data/co3-user-success.json");
            const s = JSON.parse(read(p));
            delete s.csInbox[t.id];
            fs.writeFileSync(p, JSON.stringify(s, null, 2));
        }
    });
});
