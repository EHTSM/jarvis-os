#!/bin/bash

# 🎤🖥️ JARVIS VOICE & DESKTOP CONTROL SETUP
# Install required packages for voice and desktop functionality

echo "📦 Installing Jarvis Voice & Desktop Control Packages..."
echo

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "❌ npm not found. Please install Node.js first."
    exit 1
fi

echo "Installing packages..."
echo

# Core packages (should already be installed)
echo "✅ Core packages (axios, dotenv) - assumed already installed"

# Voice control - no external packages needed for macOS (uses 'say' command)
echo "✅ Voice control: Using macOS 'say' command (built-in, no install needed)"

# Desktop automation
echo "📦 Installing robotjs for desktop control..."
npm install robotjs

# Optional: Speech recognition (Whisper API requires OpenAI key)
echo "💡 Note: Speech-to-text uses OpenAI Whisper API"
echo "   Set OPENAI_API_KEY environment variable to enable transcription"

echo
echo "✅ Installation complete!"
echo
echo "📝 Configuration:"
echo "   1. Set OPENAI_API_KEY in .env for speech-to-text"
echo "   2. Set GROQ_API_KEY in .env for AI responses"
echo
echo "🚀 Start server with: node server.js"
echo
