# BETA_MONITORING_BASELINE.md

## Key Metrics to Monitor

### 1. Health & Connectivity
- **Health endpoint** (`/jarvis`): 200 OK every 30 s.
- **SSE connection** establishment time: < 5 s.
- **Reconnection attempts**: count per hour; > 10 indicates network instability.
- **Status dot**: green 95 % of the time; red/offline > 5 % triggers alert.

### 2. Queue Performance
- **Pending tasks**: < 50 on average; spikes > 100 warrant investigation.
- **Running tasks**: < 10 concurrent; > 20 may indicate overload.
- **Completed tasks**: > 95 % success rate; < 90 % triggers alert.
- **Failed tasks (24 h)**: < 5 % of total; > 10 % requires immediate review.
- **Oldest pending**: < 30 min; > 60 min triggers alert.

### 3. Error Rates
- **API error rate**: < 1 % of total requests.
- **SSE error rate**: < 0.5 % of total connections.
- **Duplicate task attempts**: 0 (monitored via unique IDs).
- **Authentication failures**: < 0.1 % (mostly invalid passwords).

### 4. Performance
- **Task dispatch latency**: < 500 ms median.
- **Health check latency**: < 200 ms median.
- **Page load time**: < 2 s for first paint.
- **Memory growth**: < 10 % per 8‑hour session.

### 5. Operator Experience
- **Onboarding completion rate**: > 80 % of users finish all three steps.
- **Touch‑target success rate**: ≥ 95 % on mobile (via event logs).
- **Emergency stop usage**: < 1 % of sessions; if > 5 % investigate.
- **Cancel action success**: > 95 % of cancellations result in toast confirmation.

## Alert Thresholds
- **Critical**: Health endpoint down > 30 s, queue failure rate > 20 %, duplicate task detection > 0.
- **Warning**: Health latency > 1 s, pending tasks > 100, oldest pending > 45 min, error rate > 2 %.

## Monitoring Tools
- **Grafana dashboard** at `/grafana` (if deployed) with panels for the above metrics.
- **Log aggregation** via `data/logs/` with rotation every 24 h.
- **Alerting** via email/SMS on critical thresholds.

## Baseline Values (Pre‑Beta)
- Health latency: 120 ms average.
- Task dispatch: 280 ms median.
- Queue pending: 12 tasks.
- Error rate: 0.3 %.
- Onboarding completion: 92 %.

## Escalation Paths
- **Critical**: PagerDuty alert to on‑call engineer.
- **Warning**: Slack notification to #beta‑alerts channel.
- **Info**: Daily digest email to product team.

## Review Cadence
- Daily: check health, queue, error rates.
- Weekly: review onboarding funnel and mobile metrics.
- Monthly: audit telemetry for data quality and adjust thresholds.