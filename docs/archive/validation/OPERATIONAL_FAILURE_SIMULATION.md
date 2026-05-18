# OPERATIONAL_FAILURE_SIMULATION.md

## Network Interruption Recovery
- **Simulated drop**: 30 s network outage via `iptables` rule.  
- **Recovery**: Reconnect banner appears; manual “Retry Connection” button restores SSE; queue health resumes within 1 s.  
- **No data loss**: Queued tasks remain in SQLite; processing resumes automatically.  

## Reconnect Storm
- **Test**: 10 rapid disconnects within 2 minutes.  
- **Behavior**: Banner updates correctly; no duplicate execution events logged.  
- **Operator experience**: No panic; clear banner stays until successful reconnect.  

## Stale Session Handling
- **Scenario**: User refreshes while a long‑running task is pending.  
- **Outcome**: JWT persists via HTTP‑only cookie; task continues; UI shows “Resuming…” after refresh.  
- **Verification**: No duplicate tasks created; history updates correctly.  

## Failed Workflow Recovery
- **Scenario**: Task fails after 80 % completion.  
- **Recovery**: Cancel button aborts fetch; UI shows “Task cancelled” toast.  
- **Retry**: Dispatching again creates a new task with new ID; no duplicate entry.  

## Emergency Cease‑Fire Recovery
- **Procedure**: Click Emergency Stop → system halts; UI displays “Emergency stop triggered; click Resume to restore.”  
- **Resume**: When backend status clears, button appears automatically; click resumes queued tasks.  

## Summary
All simulated failure modes recover deterministically with no data loss or duplicate actions. The system remains calm and provides clear operator guidance throughout.