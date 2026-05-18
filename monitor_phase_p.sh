#!/bin/bash
# Phase P monitoring script — lightweight, single-VPS, no external deps
# Runs every 30s, writes JSONL to /tmp/phase_p_metrics.jsonl

LOG="/tmp/phase_p_metrics.jsonl"
SERVER_PORT=5050
JARVIS_URL="http://localhost:${SERVER_PORT}"

# Get PID of the main server process (node backend/server.js)
get_server_pid() {
  pgrep -f "node backend/server.js" | head -1
}

# Get RSS in MB
rss_mb() {
  local pid=$1
  ps -o rss= -p "$pid" 2>/dev/null | awk '{printf "%.1f", $1/1024}'
}

# Get CPU usage % (average over last 1s)
cpu_percent() {
  local pid=$1
  # Use ps to get %CPU
  ps -o %cpu= -p "$pid" 2>/dev/null | awk '{print $1}'
}

# Get uptime in minutes
uptime_min() {
  local pid=$1
  # Use ps -o etime= to get elapsed time in [[dd-]hh:]mm:ss format
  ps -o etime= -p "$pid" 2>/dev/null | awk -F: '{ if (NF==1) {print $1/60} else if (NF==2) {print ($1*60+$2)/60} else {print ($1*24*60+$2*60+$3)/60} }'
}

# Generate JWT token using backend middleware
gen_jwt() {
  node -e "
const { signJWT, TOKEN_EXPIRY } = require('/Users/ehtsm/jarvis-os/backend/middleware/authMiddleware');
const now = Math.floor(Date.now() / 1000);
const token = signJWT({ role: 'operator', sub: 'operator', iat: now, exp: now + TOKEN_EXPIRY });
process.stdout.write(token);
" 2>/dev/null
}

# Get queue status
queue_status() {
  local token=$1
  curl -s -w "%{http_code}" -o /dev/null -H "x-auth-token: ${token}" "${JARVIS_URL}/tasks" 2>/dev/null
}

# Get queue depth
queue_depth() {
  local token=$1
  curl -s -H "x-auth-token: ${token}" "${JARVIS_URL}/tasks" 2>/dev/null | jq '.tasks | length' 2>/dev/null || echo "0"
}

# Get PM2 restart count (if running under PM2)
pm2_restarts() {
  pm2 jlist 2>/dev/null | jq '.[0]?.restart | .?' 2>/dev/null || echo "0"
}

# Get SSE connection count (via runtimeEventBus)
sse_connections() {
  # This is approximate; we can check the number of active connections via the event bus
  # The event bus is in agents/runtime/runtimeEventBus.cjs
  # We can try to query the internal state via a diagnostic endpoint if available
  # For now, we'll return 0 as it's not easily exposed
  echo "0"
}

# Get request error count from logs (approximate)
request_errors() {
  # We can parse the log file for errors
  # For now, return 0
  echo "0"
}

# Get disk usage
disk_usage() {
  df -h / | tail -1 | awk '{print $5}' | tr -d '%'
}

# Get log file size
log_file_size() {
  # Check the main log file
  ls -lh /Users/ehtsm/jarvis-os/logs/app.log 2>/dev/null | awk '{print $5}'
}

# Sample function
sample() {
  local pid=$(get_server_pid)
  if [ -z "$pid" ]; then
    echo "{\"timestamp\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\",\"status\":\"unavailable\",\"error\":\"server process not found\"}" >> "${LOG}"
    return
  fi

  local rss=$(rss_mb "$pid")
  local cpu=$(cpu_percent "$pid")
  local uptime=$(uptime_min "$pid")
  local token=$(gen_jwt)
  local qstatus=$(queue_status "$token")
  local qdepth=$(queue_depth "$token")
  local pm2_restarts=$(pm2_restarts)
  local sse=$(sse_connections)
  local disk=$(disk_usage)
  local log_size=$(log_file_size)

  # Check thresholds
  local rss_warn=0
  local cpu_warn=0
  if [ "$rss" -gt 100 ]; then rss_warn=1; fi
  if [ "$cpu" -gt 80 ]; then cpu_warn=1; fi

  cat >> "${LOG}" <<EOF
{"timestamp":"$(date -u +"%Y-%m-%dT%H:%M:%SZ")","pid":${pid},"rss_mb":${rss},"cpu_percent":${cpu},"uptime_min":${uptime},"queue_depth":${qdepth},"queue_status":"${qstatus}","pm2_restarts":${pm2_restarts},"sse_connections":${sse},"disk_usage_percent":${disk},"log_size":"${log_size}","rss_warn":${rss_warn},"cpu_warn":${cpu_warn}}
EOF
}

# Main loop
echo "=== PHASE P MONITOR STARTED $(date) ===" >> "${LOG}"
while true; do
  sample
  sleep 30
done