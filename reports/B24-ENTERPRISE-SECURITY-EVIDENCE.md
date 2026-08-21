# B.24 — ENTERPRISE SECURITY EVIDENCE

Date: 2026-08-14 · Branch: `security/reality-completion`
Raw measured evidence. Two genuinely separate enterprise organizations, both created through the real signup flow. **No forged tokens. No bypassed controls.**

---

## Test tenants

| | Organization A | Organization B |
|---|---|---|
| Name | Meridian Global Ltd | Corvus Industries Inc |
| Org ID | `org_1786658083728_1` | `org_1786658083936_2` |
| Registration | `201` | `201` |
| Session | real `jarvis_auth` cookie | real `jarvis_auth` cookie |
| Role | `org_owner`, 20 permissions | `org_owner` |

Hierarchy built on A: workspace `ws_1786658100698_d6df7e0f` → department `dept_1786658100779_3` → team `team_1786658100862_4`.

---

## 1. Cross-tenant direct-ID reads — 13/13 DENIED

```
403  /orgs/<A>                          403  /org-agents/<A>
403  /orgs/<A>/departments               403  /org-graph/<A>
403  /orgs/<A>/teams                     403  /org-automation/<A>
403  /orgs/<A>/members                   403  /org-executive/<A>/insights
403  /orgs/<A>/missions                  403  /enterprise/dashboard/<A>
403  /orgs/<A>/billing                   403  /enterprise/policy/<A>
                                         403  /enterprise/monitoring/<A>/health

read leaks: 0/13
```

## 2. Cross-tenant writes / updates / deletes — 6/6 DENIED

```
403  POST   /orgs/<A>/departments
403  POST   /orgs/<A>/members
403  POST   /orgs/<A>/missions
403  PATCH  /orgs/<A>                      (name hijack attempt)
403  DELETE /orgs/<A>/departments/<dept>
403  PUT    /enterprise/policy/<A>         (policy downgrade attempt)

write leaks: 0/6
victim org unmodified — no intrusion artifact landed
```

## 3. Forged organization headers — 3/3 DENIED

```
403  X-Org-Id:       <A orgId>
403  X-Organization: <A orgId>
403  x-org:          <A orgId>
```

Membership is verified **server-side**; a client-asserted org header cannot widen access.

## 4. Forged role / permission headers — 3/3 DENIED

```
403  X-Role: operator
403  X-User-Role: admin
403  X-Permissions: manage_departments
```

Role is read from the **signed token only**.

## 5. Privilege escalation attempts — BOTH DENIED

```
register with role:"operator"  ->  account created as role "user"   ✓ ignored
GET /orgs/<A>/departments?orgId=<B>  ->  403                        ✓ denied
```

## 6. Role boundary — owner ≠ operator

An `org_owner` is **fully privileged inside its own organization** and **fully denied** on operator-tier infrastructure:

```
200  /orgs/<A>/departments          (owner allowed)
200  /enterprise/policy/<A>         (owner allowed)
200  /enterprise/audit/<A>/search   (owner allowed)

403  /ops/health                    (operator only)
403  /vault/dashboard               (operator only)
403  /deployment/targets            (operator only)
403  /integrations                  (operator only)
403  /ops/infra/vps                 (operator only)
```

This is a meaningful separation: the highest tenant role cannot reach platform infrastructure.

## 7. Audit log scoping — CLEAN

```
A audit entries: 2  ->  3 after a policy update  (action produced an event ✓)
sample: seq=197  type=login.password  actor=848bde2cd267dc
        org=org_1786658083728_1  ts=2026-08-13T21:54:43.893Z

entries from another org in A's log : 0  ✓
B reading A's audit log             : 403 denied ✓
A-org entries visible to B          : 0  ✓
```

**Action → audit event → correct organization → correct actor → correct timestamp**, verified end-to-end. The policy update in Workflow C incremented A's audit count from 2 to 3.

## 8. Executive metric scoping — verified with real data

Fresh tenants both returned identical all-zero pipelines. **That is not a leak** — it was verified by introducing real data on A only:

```
before:  A prospect {count:0,value:0}   B prospect {count:0,value:0}   identical=true
after:   A prospect {count:1,value:500000}   B prospect {count:0,value:0}   identical=false

B sees MERIDIAN-DEAL : false
B sees A data in /business/stats         : false ✓
B sees A data in /business/opportunities : false ✓
B sees A data in /crm/leads              : false ✓
```

`bizMissions` returned `{}` for both — the **B.21 fix holding**: no platform-wide total is presented as a tenant total.

## 9. Isolation survives a backend restart

```
auth after restart : A=OK  B=OK
hierarchy survived : 6/6 (org, departments, teams, workspaces, policy, audit)
B -> A departments : 403 denied ✓
```

---

## Regression suite added

`tests/security/97-enterprise-isolation-integrity.cjs` — **6 assertions, negative-tested.**

```
clean run      -> 6 passed, 0 failed
inverted assertion -> FAILED: INVERTED: /orgs/<A> must deny a foreign tenant (got 403)
restored       -> passes again
```

The suite creates two disposable tenants per run and **self-reports SKIPPED** when signup rate-limiting prevents tenant creation, rather than silently passing.

---

## Total security posture

| Attack class | Attempts | Denied |
|---|---:|---:|
| Cross-tenant read (direct ID) | 13 | **13** |
| Cross-tenant write / update / delete | 6 | **6** |
| Forged organization header | 3 | **3** |
| Forged role / permission header | 3 | **3** |
| Privilege escalation (registration, query param) | 2 | **2** |
| Cross-tenant audit access | 1 | **1** |
| Operator-tier access from owner role | 5 | **5** |
| **TOTAL** | **33** | **33** |

**33/33 attack vectors denied. Zero leaks. Zero escalations.**
