#!/bin/bash

#
# 🧪 JARVIS Desktop App - Complete Verification Suite
# Tests: Ports, Backend, Parser, Frontend, Full Flow
#

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║          🧪 JARVIS Desktop App - Verification Suite           ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASS=0
FAIL=0

# Helper functions
check_port() {
    local port=$1
    local name=$2
    echo -n "Checking port $port ($name)... "
    
    if lsof -Pi :$port -sTCP:LISTEN -t > /dev/null; then
        echo -e "${GREEN}✅ OPEN${NC}"
        ((PASS++))
        return 0
    else
        echo -e "${RED}❌ CLOSED${NC}"
        ((FAIL++))
        return 1
    fi
}

test_endpoint() {
    local url=$1
    local name=$2
    echo -n "Testing $name ($url)... "
    
    response=$(curl -s -w "\n%{http_code}" "$url")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)
    
    if [ "$http_code" = "200" ]; then
        echo -e "${GREEN}✅ 200 OK${NC}"
        echo "   Response: $(echo "$body" | head -c 80)..."
        ((PASS++))
        return 0
    else
        echo -e "${RED}❌ HTTP $http_code${NC}"
        ((FAIL++))
        return 1
    fi
}

test_parse_command() {
    local cmd=$1
    local label=$2
    echo -n "Testing command: '$cmd' ($label)... "
    
    response=$(curl -s -X POST http://localhost:3000/parse-command \
        -H "Content-Type: application/json" \
        -d "{\"command\": \"$cmd\"}")
    
    if echo "$response" | grep -q '"success":true'; then
        echo -e "${GREEN}✅ PARSED${NC}"
        parsed_type=$(echo "$response" | grep -o '"type":"[^"]*' | cut -d'"' -f4)
        echo "   Type: $parsed_type"
        ((PASS++))
        return 0
    else
        echo -e "${RED}❌ PARSE FAILED${NC}"
        echo "   Response: $(echo "$response" | head -c 100)..."
        ((FAIL++))
        return 1
    fi
}

# ============================================================================
echo -e "${BLUE}[1/4] System Status${NC}"
echo "────────────────────────────────────────────────────────────────"
echo "User: $(whoami)"
echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
echo "Node: $(node --version)"
echo "npm: $(npm --version)"
echo ""

# ============================================================================
echo -e "${BLUE}[2/4] Port Availability${NC}"
echo "────────────────────────────────────────────────────────────────"
check_port 3000 "Backend Server"
check_port 3001 "React Frontend"
echo ""

# ============================================================================
echo -e "${BLUE}[3/4] Backend Connectivity${NC}"
echo "────────────────────────────────────────────────────────────────"
test_endpoint "http://localhost:3000/" "Backend Health"
test_endpoint "http://localhost:3000/learning/stats" "Learning Stats Endpoint"
echo ""

# ============================================================================
echo -e "${BLUE}[4/4] Smart Command Parser${NC}"
echo "────────────────────────────────────────────────────────────────"
test_parse_command "open google" "URL Command"
test_parse_command "set timer 5 minutes" "Timer Command"
test_parse_command "hello jarvis" "Greeting Command"
test_parse_command "what time is it" "Time Query"
test_parse_command "search what is AI" "Search Command"
test_parse_command "open chrome" "App Launcher"
test_parse_command "remind me meeting" "Reminder Command"
echo ""

# ============================================================================
echo -e "${BLUE}[5/5] React Frontend${NC}"
echo "────────────────────────────────────────────────────────────────"

# Check if React server process is running
if lsof -Pi :3001 -sTCP:LISTEN -t > /dev/null; then
    echo -e "React Server: ${GREEN}✅ RUNNING${NC}"
    ((PASS++))
else
    echo -e "React Server: ${RED}❌ NOT RUNNING${NC}"
    ((FAIL++))
fi

# Check if electron/src exists
if [ -d "/Users/ehtsm/electron" ]; then
    echo -e "Electron Folder: ${GREEN}✅ EXISTS${NC}"
    ((PASS++))
else
    echo -e "Electron Folder: ${RED}❌ NOT FOUND${NC}"
    ((FAIL++))
fi

echo ""

# ============================================================================
echo "╔════════════════════════════════════════════════════════════════╗"
echo -e "║                   ${BLUE}📊 TEST SUMMARY${NC}                         ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo -e "Passed: ${GREEN}$PASS${NC} | Failed: ${RED}$FAIL${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✅ ALL TESTS PASSED!${NC}"
    echo ""
    echo "🎉 Your JARVIS Desktop App is ready to use!"
    echo ""
    echo "Next steps:"
    echo "  1. Open: http://localhost:3001"
    echo "  2. Try command: 'open google'"
    echo "  3. Watch the magic happen! 🚀"
    echo ""
    exit 0
else
    echo -e "${RED}❌ Some tests failed. Troubleshooting:${NC}"
    echo ""
    echo "Missing port 3000? Start backend:"
    echo "  cd /Users/ehtsm && node server.js"
    echo ""
    echo "Missing port 3001? Start React:"
    echo "  cd /Users/ehtsm/electron && npm start"
    echo ""
    echo "Or run the auto-startup script:"
    echo "  bash /Users/ehtsm/start-jarvis.sh"
    echo ""
    exit 1
fi
