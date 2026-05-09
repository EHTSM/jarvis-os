const fs = require("fs");

const posts = [
  "🔥 Earn ₹500–₹2000/day using AI",
  "💰 Work from phone, no skill needed",
  "🚀 Start earning online today",
  "📈 Daily income system available",
  "⚡ Limited slots open"
];

function getPost() {
  return posts[Math.floor(Math.random() * posts.length)];
}

function generateContent() {
  for (let i = 0; i < 5; i++) {
    console.log("Post:", getPost());
  }
}

generateContent();