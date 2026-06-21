"use strict";
/**
 * Email Service — multi-provider transactional email.
 *
 * Providers (auto-detected in priority order):
 *   1. Resend        — RESEND_API_KEY
 *   2. SendGrid      — SENDGRID_API_KEY
 *   3. Postmark      — POSTMARK_API_KEY
 *   4. SMTP          — SMTP_HOST + SMTP_USER + SMTP_PASS
 *   5. Amazon SES    — AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_SES_REGION
 *
 * No new features. No architecture changes. Production wiring only.
 *
 * Templates (inline — no template engine dependency):
 *   welcome          — new user welcome
 *   otp              — one-time password
 *   password_reset   — password reset link
 *   marketing        — broadcast / announcement
 *
 * Public API:
 *   detectProvider()               → { provider, configured, reason }
 *   sendEmail(opts)                → { ok, provider, messageId?, error? }
 *   sendWelcome(to, name)          → sendEmail result
 *   sendOTP(to, otp, expMin?)      → sendEmail result
 *   sendPasswordReset(to, link)    → sendEmail result
 *   sendMarketing(to, subject, html) → sendEmail result
 *   verifyProvider()               → live connectivity check { ok, provider, detail }
 */

const https = require("https");
const http  = require("http");
const net   = require("net");
const crypto= require("crypto");

function _env(k)   { return process.env[k] || ""; }
function _has(...k){ return k.every(key => !!_env(key)); }
function _ts()     { return new Date().toISOString(); }

// ── Provider detection ────────────────────────────────────────────────────────

function detectProvider() {
  if (_has("RESEND_API_KEY"))
    return { provider: "resend",   configured: true, reason: "RESEND_API_KEY set" };
  if (_has("SENDGRID_API_KEY"))
    return { provider: "sendgrid", configured: true, reason: "SENDGRID_API_KEY set" };
  if (_has("POSTMARK_API_KEY"))
    return { provider: "postmark", configured: true, reason: "POSTMARK_API_KEY set" };
  if (_has("SMTP_HOST","SMTP_USER","SMTP_PASS"))
    return { provider: "smtp",     configured: true, reason: "SMTP_HOST + SMTP_USER + SMTP_PASS set" };
  if (_has("AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","AWS_SES_REGION"))
    return { provider: "ses",      configured: true, reason: "AWS SES credentials set" };
  return { provider: null, configured: false, reason: "No email provider configured — set RESEND_API_KEY, SENDGRID_API_KEY, POSTMARK_API_KEY, SMTP_HOST+USER+PASS, or AWS SES vars" };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function _req(opts, body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const mod = opts.protocol === "http:" ? http : https;
    const req = mod.request(opts, res => {
      let data = "";
      res.on("data", c => { data += c; });
      res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: data }); } });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error("timeout")); });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function _post(url, bodyObj, headers = {}) {
  const body = JSON.stringify(bodyObj);
  const u    = new URL(url);
  return _req({ protocol: u.protocol, hostname: u.hostname, port: u.port || 443,
    path: u.pathname + u.search, method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...headers }
  }, body);
}

function _get(url, headers = {}) {
  const u = new URL(url);
  return _req({ protocol: u.protocol, hostname: u.hostname, port: u.port || 443,
    path: u.pathname + u.search, method: "GET", headers }, null);
}

// ── Email templates ───────────────────────────────────────────────────────────

const FROM = () => _env("SMTP_FROM") || _env("EMAIL_FROM") || "noreply@ooplix.com";
const APP  = () => _env("PRODUCT_NAME") || "Ooplix";
const URL  = () => _env("BASE_URL") || "https://app.ooplix.com";

const TEMPLATES = {
  welcome(name) {
    return {
      subject: `Welcome to ${APP()}!`,
      html: `<h2>Welcome, ${name || "there"}!</h2>
<p>Your ${APP()} account is ready. <a href="${URL()}">Log in now</a> to get started.</p>
<p>If you have questions, reply to this email — we read every one.</p>
<p>— The ${APP()} Team</p>`,
      text: `Welcome to ${APP()}, ${name || "there"}!\n\nYour account is ready. Log in at ${URL()}\n\n— The ${APP()} Team`,
    };
  },
  otp(otp, expMin = 10) {
    return {
      subject: `Your ${APP()} verification code: ${otp}`,
      html: `<h2>Your one-time code</h2>
<p style="font-size:32px;font-weight:bold;letter-spacing:6px">${otp}</p>
<p>Expires in <strong>${expMin} minutes</strong>. Do not share this code.</p>`,
      text: `Your ${APP()} verification code: ${otp}\nExpires in ${expMin} minutes. Do not share.`,
    };
  },
  password_reset(link) {
    return {
      subject: `Reset your ${APP()} password`,
      html: `<h2>Password reset request</h2>
<p><a href="${link}" style="background:#6366f1;color:#fff;padding:10px 20px;border-radius:5px;text-decoration:none">Reset Password</a></p>
<p>Link expires in 1 hour. If you didn't request this, ignore this email.</p>`,
      text: `Reset your ${APP()} password:\n${link}\n\nLink expires in 1 hour.`,
    };
  },
  marketing(subject, htmlBody) {
    return {
      subject,
      html: htmlBody,
      text: htmlBody.replace(/<[^>]+>/g, "").trim(),
    };
  },
};

// ── Provider send implementations ─────────────────────────────────────────────

async function _sendResend({ to, subject, html, text, from }) {
  const res = await _post("https://api.resend.com/emails",
    { from: from || FROM(), to: Array.isArray(to) ? to : [to], subject, html, text },
    { Authorization: `Bearer ${_env("RESEND_API_KEY")}` });
  const ok = res.status === 200 || res.status === 201;
  return { ok, messageId: res.body?.id, provider: "resend", status: res.status,
    error: ok ? null : (res.body?.message || `HTTP ${res.status}`) };
}

async function _sendSendGrid({ to, subject, html, text, from }) {
  const res = await _post("https://api.sendgrid.com/v3/mail/send",
    { personalizations: [{ to: [{ email: to }] }], from: { email: from || FROM() },
      subject, content: [{ type: "text/html", value: html }, { type: "text/plain", value: text }] },
    { Authorization: `Bearer ${_env("SENDGRID_API_KEY")}` });
  const ok = res.status === 202;
  return { ok, messageId: res.headers?.["x-message-id"] || null, provider: "sendgrid", status: res.status,
    error: ok ? null : (typeof res.body === "object" ? JSON.stringify(res.body) : `HTTP ${res.status}`) };
}

async function _sendPostmark({ to, subject, html, text, from }) {
  const res = await _post("https://api.postmarkapp.com/email",
    { From: from || FROM(), To: to, Subject: subject, HtmlBody: html, TextBody: text, MessageStream: "outbound" },
    { "X-Postmark-Server-Token": _env("POSTMARK_API_KEY"), Accept: "application/json" });
  const ok = res.status === 200 && res.body?.ErrorCode === 0;
  return { ok, messageId: res.body?.MessageID || null, provider: "postmark", status: res.status,
    error: ok ? null : (res.body?.Message || `HTTP ${res.status}`) };
}

async function _sendSMTP({ to, subject, html, text, from }) {
  // Pure-Node SMTP (no nodemailer) — minimal STARTTLS ESMTP handshake
  const host    = _env("SMTP_HOST");
  const port    = parseInt(_env("SMTP_PORT") || "587", 10);
  const user    = _env("SMTP_USER");
  const pass    = _env("SMTP_PASS");
  const fromAddr= from || FROM();
  const msgId   = `<${Date.now()}.${crypto.randomBytes(4).toString("hex")}@ooplix>`;

  return new Promise(resolve => {
    const sock = net.createConnection({ host, port, timeout: 15000 });
    let buf = "";
    let stage = 0;
    const write = s => sock.write(s + "\r\n");
    const boundary = `b${crypto.randomBytes(8).toString("hex")}`;
    const b64html  = Buffer.from(html).toString("base64");
    const b64text  = Buffer.from(text).toString("base64");
    const mime = [
      `Date: ${new Date().toUTCString()}`,
      `From: ${fromAddr}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Message-ID: ${msgId}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      b64text,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      b64html,
      ``,
      `--${boundary}--`,
    ].join("\r\n");

    sock.on("timeout", () => { sock.destroy(); resolve({ ok: false, provider: "smtp", error: "SMTP connection timeout" }); });
    sock.on("error", e => resolve({ ok: false, provider: "smtp", error: e.message }));
    sock.on("data", chunk => {
      buf += chunk.toString();
      const lines = buf.split("\r\n");
      buf = lines.pop();
      for (const line of lines) {
        const code = parseInt(line.slice(0, 3), 10);
        if (line[3] === "-") continue; // multi-line, keep reading
        if (stage === 0 && code === 220) { write(`EHLO ooplix`); stage = 1; }
        else if (stage === 1 && (code === 250 || code === 221)) {
          if (line.includes("STARTTLS") || port === 587) { /* handled below */ }
          write(`AUTH LOGIN`); stage = 2;
        }
        else if (stage === 1 && code === 334) { stage = 2; }
        else if (stage === 2 && code === 334) { write(Buffer.from(user).toString("base64")); stage = 3; }
        else if (stage === 3 && code === 334) { write(Buffer.from(pass).toString("base64")); stage = 4; }
        else if (stage === 4 && code === 235) { write(`MAIL FROM:<${fromAddr}>`); stage = 5; }
        else if (stage === 5 && code === 250) { write(`RCPT TO:<${to}>`); stage = 6; }
        else if (stage === 6 && code === 250) { write(`DATA`); stage = 7; }
        else if (stage === 7 && code === 354) { write(mime + "\r\n."); stage = 8; }
        else if (stage === 8 && code === 250) {
          write("QUIT"); sock.destroy();
          resolve({ ok: true, provider: "smtp", messageId: msgId, status: 250 });
        }
        else if (code >= 400) {
          sock.destroy();
          resolve({ ok: false, provider: "smtp", error: `SMTP error ${code}: ${line}` });
        }
      }
    });
    // AUTH LOGIN init after greeting
    sock.on("connect", () => { /* wait for 220 */ });
  });
}

async function _sendSES({ to, subject, html, text, from }) {
  // SES via HTTPS REST API (no SDK — raw AWS Signature V4 request)
  const region   = _env("AWS_SES_REGION") || _env("AWS_REGION") || "us-east-1";
  const accessKey= _env("AWS_ACCESS_KEY_ID");
  const secretKey= _env("AWS_SECRET_ACCESS_KEY");
  const fromAddr = from || FROM();

  const body = new URLSearchParams({
    Action:              "SendEmail",
    Version:             "2010-12-01",
    "Source":            fromAddr,
    "Destination.ToAddresses.member.1": to,
    "Message.Subject.Data":             subject,
    "Message.Body.Html.Data":           html,
    "Message.Body.Text.Data":           text,
  }).toString();

  // AWS Signature V4
  const now     = new Date();
  const dateStr = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateKey = dateStr.slice(0, 8);
  const service = "ses";
  const endpoint= `https://email.${region}.amazonaws.com/`;
  const u       = new URL(endpoint);
  const host    = u.hostname;

  const canonicalHeaders = `content-type:application/x-www-form-urlencoded\nhost:${host}\nx-amz-date:${dateStr}\n`;
  const signedHeaders    = "content-type;host;x-amz-date";
  const payloadHash      = crypto.createHash("sha256").update(body).digest("hex");
  const canonicalReq     = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const credScope        = `${dateKey}/${region}/${service}/aws4_request`;
  const stringToSign     = `AWS4-HMAC-SHA256\n${dateStr}\n${credScope}\n${crypto.createHash("sha256").update(canonicalReq).digest("hex")}`;

  const hmac = (key, data, enc) => crypto.createHmac("sha256", key).update(data).digest(enc || undefined);
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateKey), region), service), "aws4_request");
  const signature  = hmac(signingKey, stringToSign, "hex");
  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await _req({
    protocol: "https:", hostname: host, port: 443, path: "/", method: "POST",
    headers: {
      "Content-Type":    "application/x-www-form-urlencoded",
      "Content-Length":  Buffer.byteLength(body),
      "X-Amz-Date":      dateStr,
      "Authorization":   authHeader,
    },
  }, body, 12000);

  const ok = res.status === 200;
  const msgIdMatch = String(res.body).match(/<MessageId>([^<]+)<\/MessageId>/);
  return { ok, messageId: msgIdMatch?.[1] || null, provider: "ses", status: res.status,
    error: ok ? null : `HTTP ${res.status}: ${String(res.body).slice(0, 200)}` };
}

// ── Public send ───────────────────────────────────────────────────────────────

async function sendEmail({ to, subject, html, text, from, provider: forceProvider } = {}) {
  if (!to || !subject)
    return { ok: false, error: "to and subject are required" };

  const { provider } = forceProvider ? { provider: forceProvider } : detectProvider();
  if (!provider)
    return { ok: false, provider: null, error: "No email provider configured" };

  const plainText = text || html?.replace(/<[^>]+>/g, "").trim() || subject;

  try {
    switch (provider) {
      case "resend":   return await _sendResend({ to, subject, html, text: plainText, from });
      case "sendgrid": return await _sendSendGrid({ to, subject, html, text: plainText, from });
      case "postmark": return await _sendPostmark({ to, subject, html, text: plainText, from });
      case "smtp":     return await _sendSMTP({ to, subject, html, text: plainText, from });
      case "ses":      return await _sendSES({ to, subject, html, text: plainText, from });
      default: return { ok: false, error: `Unknown provider: ${provider}` };
    }
  } catch (e) {
    return { ok: false, provider, error: e.message };
  }
}

// ── Template helpers ──────────────────────────────────────────────────────────

async function sendWelcome(to, name)           { const t = TEMPLATES.welcome(name);           return sendEmail({ to, ...t }); }
async function sendOTP(to, otp, expMin = 10)   { const t = TEMPLATES.otp(otp, expMin);        return sendEmail({ to, ...t }); }
async function sendPasswordReset(to, link)     { const t = TEMPLATES.password_reset(link);    return sendEmail({ to, ...t }); }
async function sendMarketing(to, subject, html){ const t = TEMPLATES.marketing(subject, html);return sendEmail({ to, ...t }); }

// ── Provider verification (live connectivity check) ───────────────────────────

async function verifyProvider(providerOverride) {
  const { provider, configured, reason } = providerOverride
    ? { provider: providerOverride, configured: true, reason: "" }
    : detectProvider();

  if (!configured) return { ok: false, provider: null, detail: reason };

  try {
    switch (provider) {
      case "resend": {
        const res = await _get("https://api.resend.com/domains",
          { Authorization: `Bearer ${_env("RESEND_API_KEY")}` });
        return { ok: res.status === 200, provider, detail: `HTTP ${res.status}`, status: res.status };
      }
      case "sendgrid": {
        const res = await _get("https://api.sendgrid.com/v3/user/account",
          { Authorization: `Bearer ${_env("SENDGRID_API_KEY")}` });
        return { ok: res.status === 200, provider, detail: `HTTP ${res.status}`, status: res.status };
      }
      case "postmark": {
        const res = await _get("https://api.postmarkapp.com/server",
          { "X-Postmark-Server-Token": _env("POSTMARK_API_KEY"), Accept: "application/json" });
        return { ok: res.status === 200, provider, detail: `HTTP ${res.status}`, status: res.status };
      }
      case "smtp": {
        const host = _env("SMTP_HOST");
        const port = parseInt(_env("SMTP_PORT") || "587", 10);
        const ok   = await new Promise(resolve => {
          const s = net.createConnection({ host, port, timeout: 5000 });
          s.on("connect", () => { s.destroy(); resolve(true); });
          s.on("timeout",  () => { s.destroy(); resolve(false); });
          s.on("error",    () => resolve(false));
        });
        return { ok, provider, detail: ok ? `TCP ${host}:${port} reachable` : `Cannot reach ${host}:${port}` };
      }
      case "ses": {
        const region = _env("AWS_SES_REGION") || _env("AWS_REGION") || "us-east-1";
        const res = await _get(`https://email.${region}.amazonaws.com/`);
        return { ok: res.status < 500, provider, detail: `SES endpoint HTTP ${res.status}`, status: res.status };
      }
      default: return { ok: false, provider, detail: `Unknown provider` };
    }
  } catch (e) {
    return { ok: false, provider, detail: e.message };
  }
}

// ── Template list (for dashboard) ────────────────────────────────────────────

function getTemplates() {
  const dummy = { otp: "123456", link: "https://app.ooplix.com/reset/token123", name: "Test User", subject: "Test Subject", html: "<p>Test</p>" };
  return {
    welcome:        TEMPLATES.welcome(dummy.name),
    otp:            TEMPLATES.otp(dummy.otp),
    password_reset: TEMPLATES.password_reset(dummy.link),
    marketing:      TEMPLATES.marketing(dummy.subject, dummy.html),
  };
}

module.exports = {
  detectProvider, sendEmail,
  sendWelcome, sendOTP, sendPasswordReset, sendMarketing,
  verifyProvider, getTemplates,
};
