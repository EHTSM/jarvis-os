# LOGGING_DISCIPLINE.md

**Purpose** – Audit logging practices to ensure logs are useful, not overwhelming, and contain no sensitive data.

---

## 1. Current Log Structure

### 1.1 Log File Location
```
logs/
  jarvis-YYYY-MM-DD.log
  archive/
    jarvis-*.log.gz
```

### 1.2 Log Levels (observed)
- DEBUG: verbose pipeline logs (when `DEBUG=true`)
- INFO: normal operation
- WARN: non‑critical issues
- ERROR: failures
- FATAL: unrecoverable errors

---

## 2. Audit Findings

### 2.1 Noisy Logs ✅
- **Issue**: Agents log every action (e.g., `Task 1/1: Processing type="open_google"`)
- **Impact**: Log file grows 5‑10 MB/day
- **Severity**: Medium
- **Recommendation**: Reduce INFO level to every 10th task; keep ERROR+REQUIRED

### 2.2 Missing Logs ⚠️
- **Issue**: Queue failures not logged
- **Impact**: Operators cannot trace why tasks didn't run
- **Severity**: High
- **Recommendation**: Add `queue_error` log on failed task execution

### 2.3 Unclear Logs ⚠️
- **Issue**: Generic messages like "Pipeline stopped"
- **Impact**: Operators need to dig into stack traces
- **Severity**: Medium
- **Recommendation**: Add context (task_id, error_code, timestamp)

### 2.4 Sensitive Data Exposure ⚠️
- **Issue**: Logs may contain tokens, passwords, API keys
- **Impact**: Security breach risk
- **Severity**: Critical
- **Recommendation**: Mask sensitive values; audit all log statements

---

## 3. Logging Discipline Rules

### 3.1 Log Level Guidelines
| Level | When to Use | Examples |
|-------|-------------|---------|
| ERROR | Failures that impact operation | `Task execution failed: open_google [task_id=abc]` |
| WARN | Issues that may degrade experience | `SSE heartbeat missed for 30s` |
| INFO | Major lifecycle events only | `Queue: 5 tasks processed, 1 failed` |
| DEBUG | Detailed debugging (only when requested) | `Request payload: {command: "..."}` |
| NONE | No logging for sensitive data | No tokens, passwords, keys |

### 3.2 Required Context in Every Log
- `[timestamp]`
- `[task_id]` (if applicable)
- `[agent]` (agent name)
- `[level]`
- Human‑readable message

### 3.3 Sensitive Data Rules
- **NEVER log**: JWT tokens, API keys, passwords, PII
- **ALWAYS mask**: IP addresses, user IDs, file paths
- **ALLOW**: Commands (generic), task types, result summaries

---

## 4. Implementation Changes Needed

### 4.1 Agent Updates (priority order)
1. **queueAgent.cjs** – Add queue_error logging
2. **paymentAgent.cjs** – Mask payment data
3. **whatsappAgent.cjs** – Mask phone numbers
4. **telegramAgent.cjs** – Mask chat IDs
5. **terminalAgent.cjs** – Reduce INFO frequency

### 4.2 Log Rotation Policy
- Rotate daily at 00:00
- Keep 7 days of active logs
- Archive 30 days gzipped
- Delete > 90 days

### 4.3 Log Filtering
- Implement `--filter` flag for `tail -f logs/jarvis.log | grep -i ERROR`
- Add log level selector in dashboard
- Support `--since` flag for time‑based queries

---

## 5. Log Monitoring

### 5.1 Watch Commands (run continuously)
```bash
# Error tracking
tail -f logs/jarvis-$(date +%F).log | grep -iE "error|fail|exception"

# Queue status
tail -f logs/jarvis-$(date +%F).log | grep -i "queue"

# Auth failures
tail -f logs/jarvis-$(date +%F).log | grep -i "auth"
```

### 5.2 Dashboard Integration
- Show last 50 log entries
- Color‑code by level
- Provide filter dropdowns

---

## 6. Verification

### 6.1 Sensitive Data Scan
```bash
# Scan for potential leaks
grep -iE "token|password|secret|key|jwt" logs/*.log
```

### 6.2 Log Size Check
```bash
# Ensure daily logs < 50 MB
du -sh logs/
```

### 6.3 Log Rotation Test
```bash
# Simulate day change and verify rotation
logrotate -f /etc/logrotate.d/jarvis
du -sh logs/
```

---

## 7. Checklist

### 7.1 Daily
- [ ] Log rotation completed
- [ ] No ERROR entries without context
- [ ] No sensitive data in logs
- [ ] Log size < 50 MB

### 7.2 Weekly
- [ ] Archive verification (logs archived properly)
- [ ] Sensitive data scan clean
- [ ] Dashboard log viewer functional

### 7.3 Monthly
- [ ] Full log audit
- [ ] Update logging discipline rules
- [ ] Review agent log statements

---

## 8. Summary

**Current Status**: Logs functional but noisy and lacking context
**Priority Fix**: Add queue_error logging and mask sensitive data
**Target**: Reduce log noise by 80 %, eliminate sensitive data exposure

---

*Review this document quarterly.*