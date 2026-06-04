"use strict";
import * as vscode from "vscode";
import { JarvisClient } from "./jarvisClient";

type ChatMode = "general" | "repo" | "file" | "explain" | "generate" | "refactor" | "fix";

interface ChatContext {
    code?: string;
    file?: string;
    lang?: string;
    prompt?: string;
    errors?: unknown[];
}

export class JarvisChatPanel {
    static currentPanel: JarvisChatPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _history: Array<{ role: "user" | "assistant"; content: string }> = [];

    static createOrShow(uri: vscode.Uri, client: JarvisClient, mode: ChatMode, ctx?: ChatContext) {
        const col = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Beside;
        if (JarvisChatPanel.currentPanel) {
            JarvisChatPanel.currentPanel._panel.reveal(col);
            JarvisChatPanel.currentPanel._onMode(mode, ctx, client);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            "jarvisChat",
            "JARVIS Chat",
            col,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        JarvisChatPanel.currentPanel = new JarvisChatPanel(panel, client, mode, ctx);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private client: JarvisClient,
        mode: ChatMode,
        ctx?: ChatContext
    ) {
        this._panel = panel;
        this._panel.webview.html = this._buildHtml();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(msg => this._onMessage(msg), null, this._disposables);
        this._onMode(mode, ctx, client);
    }

    private async _onMode(mode: ChatMode, ctx: ChatContext | undefined, client: JarvisClient) {
        this.client = client;
        const send = (role: "user" | "assistant" | "system", content: string) =>
            this._panel.webview.postMessage({ type: "message", role, content });

        if (mode === "explain" && ctx?.code) {
            send("system", `**Explain Code** — \`${ctx.file ?? ""}\``);
            this._post(`Explain this ${ctx.lang ?? ""} code:\n\`\`\`${ctx.lang ?? ""}\n${ctx.code}\n\`\`\``);
        } else if (mode === "refactor" && ctx?.code) {
            send("system", `**Refactor Code** — \`${ctx.file ?? ""}\``);
            this._post(`Refactor this ${ctx.lang ?? ""} code:\n\`\`\`${ctx.lang ?? ""}\n${ctx.code}\n\`\`\``);
        } else if (mode === "fix" && ctx?.code) {
            send("system", `**Fix Errors** — \`${ctx.file ?? ""}\``);
            const errList = (ctx.errors as any[])?.map((e: any) => `Line ${e.line}: ${e.msg}`).join("\n") ?? "";
            this._post(`Fix these errors in the ${ctx.lang ?? ""} code:\n${errList}\n\`\`\`${ctx.lang ?? ""}\n${ctx.code}\n\`\`\``);
        } else if (mode === "generate" && ctx?.prompt) {
            send("system", `**Generate Code** — ${ctx.lang ?? ""}`);
            this._post(`Generate ${ctx.lang ?? ""} code: ${ctx.prompt}`);
        } else if (mode === "repo") {
            send("system", "**Repo Chat** — ask anything about the indexed repository");
        } else if (mode === "file" && ctx?.file) {
            send("system", `**File Chat** — \`${ctx.file}\``);
        } else {
            send("system", "**JARVIS Engineering Chat** — Cursor-class assistant");
        }
    }

    private async _post(userMsg: string) {
        this._history.push({ role: "user", content: userMsg });
        this._panel.webview.postMessage({ type: "message", role: "user", content: userMsg });
        this._panel.webview.postMessage({ type: "typing", value: true });
        try {
            const reply = await this.client.chat(this._history);
            this._history.push({ role: "assistant", content: reply });
            this._panel.webview.postMessage({ type: "message", role: "assistant", content: reply });
        } catch (e: any) {
            this._panel.webview.postMessage({ type: "message", role: "assistant", content: `Error: ${e.message}` });
        } finally {
            this._panel.webview.postMessage({ type: "typing", value: false });
        }
    }

    private async _onMessage(msg: { type: string; content?: string }) {
        if (msg.type === "userMessage" && msg.content) {
            await this._post(msg.content);
        } else if (msg.type === "clear") {
            this._history = [];
        }
    }

    private _buildHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  :root { --bg: var(--vscode-editor-background); --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border); --accent: var(--vscode-button-background);
    --accent-fg: var(--vscode-button-foreground); --input-bg: var(--vscode-input-background); }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--fg); font-family: var(--vscode-font-family); font-size: 13px; display: flex; flex-direction: column; height: 100vh; }
  #header { padding: 8px 12px; border-bottom: 1px solid var(--border); font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
  #messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .msg { padding: 8px 12px; border-radius: 6px; max-width: 90%; white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
  .user { background: var(--accent); color: var(--accent-fg); align-self: flex-end; }
  .assistant { background: var(--vscode-editorWidget-background,#2d2d2d); align-self: flex-start; }
  .system { background: transparent; color: var(--vscode-descriptionForeground); font-style: italic; font-size: 11px; align-self: center; }
  #typing { padding: 4px 12px; font-style: italic; color: var(--vscode-descriptionForeground); font-size: 11px; min-height: 18px; }
  #input-row { display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--border); }
  #input { flex: 1; background: var(--input-bg); color: var(--fg); border: 1px solid var(--border); border-radius: 4px; padding: 6px 10px; font-size: 13px; resize: none; height: 60px; }
  #send { background: var(--accent); color: var(--accent-fg); border: none; border-radius: 4px; padding: 0 14px; cursor: pointer; font-size: 13px; }
  #send:hover { opacity: 0.85; }
  code, pre { font-family: var(--vscode-editor-font-family, monospace); background: rgba(0,0,0,0.2); padding: 2px 4px; border-radius: 3px; }
  pre { display: block; padding: 8px; overflow-x: auto; margin: 4px 0; }
  #clear-btn { background: none; border: none; color: var(--vscode-descriptionForeground); cursor: pointer; font-size: 11px; }
</style>
</head>
<body>
<div id="header">
  <span>⚡ JARVIS Engineering</span>
  <button id="clear-btn" onclick="clearChat()">Clear</button>
</div>
<div id="messages"></div>
<div id="typing"></div>
<div id="input-row">
  <textarea id="input" placeholder="Ask anything about your code..." onkeydown="onKey(event)"></textarea>
  <button id="send" onclick="sendMsg()">Send</button>
</div>
<script>
const vscode = acquireVsCodeApi();
const msgs = document.getElementById('messages');
const typing = document.getElementById('typing');

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function renderContent(s) {
  // minimal code block rendering
  return escHtml(s).replace(/\`\`\`([^\\n]*)?\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>')
    .replace(/\`([^\`]+)\`/g, '<code>$1</code>');
}

window.addEventListener('message', e => {
  const { type, role, content, value } = e.data;
  if (type === 'message') {
    const d = document.createElement('div');
    d.className = 'msg ' + role;
    d.innerHTML = renderContent(content);
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  } else if (type === 'typing') {
    typing.textContent = value ? 'JARVIS is thinking…' : '';
  }
});

function sendMsg() {
  const inp = document.getElementById('input');
  const text = inp.value.trim();
  if (!text) return;
  vscode.postMessage({ type: 'userMessage', content: text });
  inp.value = '';
}

function onKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
}

function clearChat() {
  msgs.innerHTML = '';
  vscode.postMessage({ type: 'clear' });
}
</script>
</body>
</html>`;
    }

    dispose() {
        JarvisChatPanel.currentPanel = undefined;
        this._panel.dispose();
        this._disposables.forEach(d => d.dispose());
    }
}
