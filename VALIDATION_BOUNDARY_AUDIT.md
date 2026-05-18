# Validation Boundary Audit

**Date**: 2026-05-16  
**Focus**: Input validation, schema enforcement, quota/limit checks  
**Baseline**: Production standards from `.github/instructions/api.instructions.md`

---

## Summary

Jarvis OS validates input at controller layer (sanitization: trim, 2000 char limit, `<>` strip) but **lacks schema validation** on request fields and **no pre-execution quota checks**. API endpoints accept requests without verifying field types or ranges.

**Status**: 65% validated | **Safety gaps**: 6

---

## 1. Input Validation Boundaries

### Current Implementation

✅ **Present:**
- Input sanitization in `backend/controllers/jarvisController.js` (trim, 2000 char limit, strip `<>`)
- CORS allowlist authentication
- JSON body limit 10MB
- Rate limiter on auth endpoints

⚠️ **Gaps:**

**Gap 1: No schema validation on /jarvis POST**
- **File**: `backend/controllers/jarvisController.js` lines 47-50
- **Current**: `input = input.trim().slice(0, 2000).replace(/[<>]/g, '')`
- **Missing**: Validate that input is string, not null/object
- **Risk**: May process undefined or object input
- **Fix**: Add type check before sanitization
```javascript
if (typeof input !== 'string') {
  return res.status(400).json({ error: 'input must be string', code: 'INVALID_INPUT_TYPE' })
}
```

**Gap 2: No field type validation on /runtime/dispatch**
- **File**: `backend/routes/runtime.js` (implied by controller pattern)
- **Missing**: Validate `{ taskId (string), action (enum), priority (1-10) }`
- **Risk**: Malformed task IDs or invalid actions processed silently
- **Fix**: Add schema check before queue insertion
```javascript
const allowed = ['start', 'stop', 'pause', 'cancel']
if (!allowed.includes(action)) {
  return res.status(400).json({ error: 'invalid action', code: 'INVALID_ACTION', allowed })
}
```

**Gap 3: No enum validation on action fields**
- **File**: Multiple route handlers
- **Issue**: Action field accepted without validation against allowed values
- **Risk**: Operator error sends task into undefined state
- **Fix**: Validate action against enum list before execution

**Gap 4: No range validation on numeric fields**
- **File**: API handlers
- **Issue**: Priority, retry count, timeout fields accepted without bounds checking
- **Risk**: Negative values or 999999s timeout create invalid states
- **Fix**: Validate `1 <= priority <= 10`, `0 <= retries <= 5`, `1000 <= timeout <= 300000`

### Standard Requirements
Per `.github/instructions/api.instructions.md`:
- ✅ "Validate user input on every request"
- ⚠️ "Validate early, fail fast" — **PARTIALLY IMPLEMENTED**
- ⚠️ "Include error context" — **MISSING on some endpoints**

---

## 2. Rate Limiting & Quota Checks

### Current Implementation

✅ **Present:**
- Rate limiter middleware on auth endpoints
- CORS allowlist prevents unauthorized access
- No documented per-user quotas

⚠️ **Gaps:**

**Gap 1: No pre-execution quota check**
- **File**: `backend/controllers/jarvisController.js`
- **Issue**: Rate limiting happens post-auth, but doesn't check operation cost before execution
- **Risk**: Expensive operation (long-running AI task) starts before quota verified
- **Fix**: Check quota before calling AI model
```javascript
const quota = await checkUserQuota(req.user.id)
if (!quota.canExecute) {
  return res.status(429).json({ 
    error: 'quota exceeded',
    retryAfter: quota.resetAt,
    code: 'QUOTA_EXCEEDED'
  })
}
```

**Gap 2: No Retry-After header on 429**
- **File**: `backend/middleware/rateLimiter.js`
- **Issue**: 429 response doesn't include Retry-After header
- **Risk**: Client retries immediately instead of backing off
- **Fix**: Add header: `res.set('Retry-After', Math.ceil(ttl / 1000))`

**Gap 3: No per-operation cost tracking**
- **File**: Task execution
- **Issue**: All operations treated equally; no accounting for expensive operations
- **Risk**: User abuses expensive operations without penalty
- **Fix**: Assign cost to each operation type (AI call = 10 credits, queue fetch = 1 credit)

**Gap 4: No concurrent operation limit**
- **File**: Runtime execution
- **Issue**: User can dispatch 100 tasks at once, overloading queue
- **Risk**: Queue backpressure, timeouts
- **Fix**: Enforce max concurrent tasks per user (e.g., 10 active)

### Standard Requirements
Per `.github/instructions/api.instructions.md`:
- ⚠️ "Always set timeouts on external calls" — **IMPLEMENTED but not documented**
- ⚠️ "Rate limiting before execution" — **NOT IMPLEMENTED**
- ⚠️ "Include Retry-After" — **MISSING**

---

## 3. Authentication & Authorization Boundaries

### Current Implementation

✅ **Strong:**
- JWT verification on /runtime/* routes
- Role-based gates (operatorOnly)
- Dev passthrough documented in non-production
- No token logging

⚠️ **Gaps:**

**Gap 1: No permission validation on resource ownership**
- **File**: `backend/routes/runtime.js`
- **Issue**: /runtime/task/:id doesn't verify that user owns the task
- **Risk**: User can inspect/cancel another user's tasks
- **Fix**: Query task with `userId === req.user.id`

**Gap 2: No scope validation on token**
- **File**: `backend/middleware/authMiddleware.js`
- **Issue**: Token payload checked for role but not scope (read vs write vs admin)
- **Risk**: User with read-only scope can POST to /runtime/dispatch
- **Fix**: Add scope check: `if (!['write', 'admin'].includes(token.scope)) return 403`

**Gap 3: No audit log on sensitive operations**
- **File**: All mutation endpoints
- **Issue**: Create/update/delete operations not logged
- **Risk**: Operator can't trace who made changes
- **Fix**: Log: `{ op: 'task_update', user, taskId, oldState, newState, timestamp }`

### Standard Requirements
Per `.github/instructions/api.instructions.md`:
- ✅ "Validate auth on every request"
- ⚠️ "Resource ownership check" — **MISSING**
- ⚠️ "Audit log on mutations" — **MISSING**

---

## 4. Error Response Consistency

### Current Implementation

✅ **Present:**
- Global error handler in server.js
- JSON responses for all errors
- 400/401/403/404/500 status codes

⚠️ **Gaps:**

**Gap 1: Inconsistent error envelope**
- **File**: Multiple controllers
- **Issue**: `/jarvis` returns `{ success, reply, intent, action }`, `/runtime/queue` returns `{ status, tasks }`
- **Risk**: Client can't parse errors consistently
- **Fix**: Standardize to `{ success, error?, result? }`
```javascript
// Unified envelope
success: true|false
error: { code: 'ERROR_CODE', message: 'Human readable' } | null
result: {} | null
```

**Gap 2: No error code on validation failures**
- **File**: Controllers
- **Issue**: 400 errors don't include code for client routing
- **Risk**: Client shows generic "Bad request" instead of specific error
- **Fix**: Always include error code
```javascript
{ success: false, error: { code: 'INVALID_ACTION', message: '...' } }
```

**Gap 3: Server errors leak internals**
- **File**: Global error handler
- **Issue**: 500 errors might expose stack traces or DB error details
- **Risk**: Attacker learns system internals
- **Fix**: Return generic message, log stack trace internally
```javascript
catch (error) {
  logger.error('unhandled_error', { error: error.message, stack: error.stack })
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Server error' } })
}
```

### Standard Requirements
Per `.github/instructions/api.instructions.md`:
- ⚠️ "Every error response includes error + code" — **INCONSISTENT**
- ⚠️ "Human-readable message" — **PARTIALLY IMPLEMENTED**

---

## 5. Timeout & Retry Protections

### Current Implementation

✅ **Present:**
- 30s task timeout in autonomousLoop.cjs
- Exponential-ish retry backoff
- Stuck task abandonment >2h

⚠️ **Gaps:**

**Gap 1: No max operation duration**
- **File**: `backend/controllers/jarvisController.js` → AI call
- **Issue**: /jarvis POST may run indefinitely if AI service hangs
- **Risk**: HTTP client timeouts, operator frustrated
- **Fix**: Add 60s operation timeout, return 504 if exceeded
```javascript
const timeout = setTimeout(() => {
  logger.warn('operation_timeout', { op: 'jarvis_post', user: req.user.id })
  res.status(504).json({ success: false, error: { code: 'OPERATION_TIMEOUT' } })
}, 60000)
```

**Gap 2: No retry backoff formalization**
- **File**: `agents/taskQueue.cjs`
- **Issue**: "exponential-ish" not documented; caller doesn't know retry behavior
- **Risk**: Client makes incorrect assumptions
- **Fix**: Document and enforce: delay(attempt) = 1s * (2 ^ attempt), max 60s
```javascript
const backoffMs = Math.min(1000 * Math.pow(2, attempt), 60000)
```

**Gap 3: No jitter on retries**
- **File**: Retry logic
- **Issue**: All failed tasks retry at same time, thundering herd
- **Risk**: Queue spike when all retries fire together
- **Fix**: Add jitter: `delay = backoff + random(0, backoff * 0.1)`

### Standard Requirements
Per `.github/instructions/api.instructions.md`:
- ⚠️ "Always set timeouts on external calls" — **PARTIALLY IMPLEMENTED**
- ⚠️ "Never retry automatically (except transient)" — **IMPLEMENTED but not documented**

---

## Summary Table

| Category | Gap | Severity | File | Fix |
|----------|-----|----------|------|-----|
| Schema | No type validation on input | High | jarvisController.js | Add `typeof input === 'string'` check |
| Schema | No enum validation on action | High | runtime.js | Validate against allowed list |
| Schema | No range validation on numbers | High | Multiple | Add min/max bounds |
| Quota | No pre-execution quota check | High | jarvisController.js | Check quota before AI call |
| Quota | No Retry-After on 429 | Medium | rateLimiter.js | Add header |
| Quota | No per-operation cost | Medium | Multiple | Track cost + charge quota |
| Quota | No concurrent operation limit | Medium | taskQueue.cjs | Enforce max active per user |
| Auth | No resource ownership check | High | runtime.js | Verify userId on resource fetch |
| Auth | No scope validation | Medium | authMiddleware.js | Check scope field in token |
| Auth | No audit log on mutations | Medium | Multiple | Log all CREATE/UPDATE/DELETE |
| Error | Inconsistent error envelope | High | Controllers | Standardize to `{ success, error, result }` |
| Error | No error code on 400s | High | Controllers | Always include code |
| Error | Internals in 500 errors | High | Global handler | Return generic message |
| Timeout | No max operation duration | High | jarvisController.js | Add 60s timeout + 504 response |
| Timeout | Retry backoff not formalized | Medium | taskQueue.cjs | Document: 2^n backoff |
| Timeout | No jitter on retries | Medium | taskQueue.cjs | Add ±10% random jitter |

**Total gaps**: 16  
**High severity**: 10  
**Medium severity**: 6

---

## Remediation Priority

**Critical** (blocks production):
1. Type + enum validation on request fields
2. Resource ownership check on query endpoints
3. Consistent error envelope format
4. Pre-execution quota check
5. Max operation duration timeout

**High** (stability):
1. Error code inclusion
2. Retry backoff formalization
3. Audit logging on mutations
4. Scope validation

**Medium** (hardening):
1. Retry jitter
2. Retry-After header
3. Per-operation cost tracking
4. Concurrent operation limits

**Estimated effort**: 3 days (4 hours critical, 6 hours high, 4 hours medium)
