#!/usr/bin/env node
"use strict";
/**
 * Usage: node scripts/generate-password-hash.cjs <password>
 *
 * Outputs OPERATOR_PASSWORD_HASH and a new JWT_SECRET to paste into .env
 */
const crypto = require("crypto");

const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/generate-password-hash.cjs <password>");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const salt  = crypto.randomBytes(16).toString("hex");
const hash  = crypto.scryptSync(password, salt, 64).toString("hex");
const stored = `${salt}:${hash}`;

console.log("\n# Add these lines to your .env file:\n");
console.log(`OPERATOR_PASSWORD_HASH=${stored}`);
console.log(`JWT_SECRET=${crypto.randomBytes(32).toString("hex")}`);
console.log("\n# Keep these secret — do NOT commit .env to git.\n");
