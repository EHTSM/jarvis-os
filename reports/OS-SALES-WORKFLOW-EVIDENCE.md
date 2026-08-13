# Sales OS — Workflow Evidence

All measurements from the live backend with **two real tenants** created through
the real signup flow (`POST /accounts/register` → `POST /api/auth/login`). No
forged tokens.

| Tenant | Org | Workspace |
|---|---|---|
| A — Vertex Sales Co | `org_1786659120993_2` | `ws_1786659120916_abf5b30b` |
| B — Quanta Rival Co | `org_1786659121309_4` | `ws_1786659121251_8e592a10` |

---

## Full lifecycle — executed end to end

```
1 create lead      : 200 lead_1786659138220_7c709d (12ms)
2 read lead        : 200 Alina Roy (6ms)
3 update lead      : 200 value=72000 (6ms)
4 qualify lead     : 200 status=qualified (13ms)
5 create opp       : 200 opp_1786659150313_94a682 stage=prospect (13ms)
advance -> qualified    200 now=qualified (107ms)
advance -> proposal     200 now=proposal (13ms)
advance -> negotiation  200 now=negotiation (6ms)
close-won               200 stage=closed-won (5ms)
```

**Pipeline tracked every transition correctly:**
```
{"prospect":{"count":0,...},"closed-won":{"count":1,"value":72000},...}
```

### Two payload errors were mine, not defects

`POST /business/opportunities` returned `400 title required` (I sent `name`), and
`advance` returned `400 stage required` (I sent an empty body). Both are correct
input validation. Neither is recorded as a defect.

---

## Close-lost — verified separately

```
close-lost: 200 stage=closed-lost
  revenue unchanged: PASS (151000)
```

A lost deal correctly produces **no** revenue.

---

## Persistence across backend restart

```
after restart — revenue total: 151000 count: 3
after restart — pipeline: closed-won retained
after restart — leads: 4
```

---

## Cross-OS integration — Sales revenue reaches reporting

| Consumer | Result |
|---|---|
| `GET /business/stats` | `revenue: {"total":151000,"count":3,"byType":{"one-time":151000}}` |
| `GET /business/dashboard` | `revenue: {"total":151000,"count":3}` |
| `GET /analytics/executive` | 200, real KPI payload |

Sales → Business → Executive reporting is **verified with matching figures**, not
assumed from similar names.

---

## Performance — measured, 10 samples each

| Workflow | p50 | max |
|---|---|---|
| Leads list | 6 ms | 12 ms |
| Opportunities list | 5 ms | 11 ms |
| Pipeline | 8 ms | 11 ms |
| Revenue stats | 5 ms | 10 ms |
| Dashboard | 6 ms | 9 ms |

**0 requests over 2 s.** No UX score was manufactured.
