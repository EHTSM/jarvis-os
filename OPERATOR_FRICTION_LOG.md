# OPERATOR_FRICTION_LOG.md

## Phase Q - Real Daily Operator Mode

**Date**: 2026-05-16  
**Operator**: Claude Code (simulating daily operations)

---

## Friction Log - Initial Observations

### ✅ **Positive Observations**
- System appears to be in a stable state with clear documentation
- Good separation of concerns in the architecture
- Multiple agents available for different tasks
- Clear boundaries between core and plugins

### ⚠️ **Areas of Friction**

#### 1. **Startup Complexity**
- **Issue**: Multiple startup scripts (`start-jarvis.sh`, `start-jarvis copy.sh`) create confusion
- **Impact**: 3/5 - Operator uncertainty about which script to use
- **Location**: `/Users/ehtsm/jarvis-os/`
- **Suggestion**: Consolidate into single, well-documented startup script

#### 2. **Agent Discovery**
- **Issue**: 60+ agents in `/agents/` directory with unclear purpose
- **Impact**: 4/5 - Hard to find the right agent for a task
- **Location**: `/Users/ehtsm/jarvis-os/agents/`
- **Suggestion**: Create agent registry or categorization system

#### 3. **Queue Management**
- **Issue**: No clear view of task queue status or pending items
- **Impact**: 5/5 - High anxiety for operators
- **Location**: Task queue system
- **Suggestion**: Add queue monitoring endpoint

#### 4. **Error Handling**
- **Issue**: Error messages are technical and not actionable
- **Impact**: 4/5 - Operators struggle to understand failures
- **Location**: Various agents
- **Suggestion**: Implement user-friendly error messages with recovery steps

#### 5. **Mobile Dashboard**
- **Issue**: Mobile app exists but unclear how to use for operations
- **Impact**: 3/5 - Missed opportunity for remote management
- **Location**: `/Users/ehtsm/jarvis-os/mobile/`
- **Suggestion**: Document mobile dashboard usage

#### 6. **Logging Overload**
- **Issue**: Logs contain too much technical detail, hard to filter
- **Impact**: 3/5 - Operators waste time finding relevant info
- **Location**: `/Users/ehtsm/jarvis-os/logs/`
- **Suggestion**: Implement log levels and filtering

#### 7. **Reconnection Logic**
- **Issue**: Unclear how system behaves after unexpected disconnect
- **Impact**: 4/5 - Operator uncertainty during failures
- **Location**: Network layer
- **Suggestion**: Add connection status monitoring

#### 8. **Configuration Management**
- **Issue**: Multiple `.env` files with unclear differences
- **Impact**: 3/5 - Configuration mistakes likely
- **Location**: `/Users/ehtsm/jarvis-os/`
- **Suggestion**: Consolidate into single config system

---

## Next Steps

1. **Immediate Micro-Fixes**:
   - [ ] Clean up startup scripts
   - [ ] Add basic queue status endpoint
   - [ ] Improve error messages in key agents

2. **Further Investigation**:
   - [ ] Test mobile dashboard functionality
   - [ ] Audit logging system
   - [ ] Document reconnection behavior

3. **Long-term Improvements**:
   - [ ] Create agent registry
   - [ ] Implement proper configuration management
   - [ ] Build operator-friendly monitoring UI

---
**Last Updated**: 2026-05-16
**Operator**: Claude Code