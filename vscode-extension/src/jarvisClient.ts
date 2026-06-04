"use strict";
import * as vscode from "vscode";
import * as https from "https";
import * as http from "http";

interface ChatMessage { role: "user" | "assistant" | "system"; content: string; }

function cfg() { return vscode.workspace.getConfiguration("jarvis"); }

function baseUrl(): string {
    return (cfg().get<string>("serverUrl") ?? "http://localhost:5050").replace(/\/$/, "");
}

function provider(): { provider: string; model: string; apiKey: string; ollamaUrl: string } {
    return {
        provider:  cfg().get<string>("provider")   ?? "openrouter",
        model:     cfg().get<string>("model")      ?? "anthropic/claude-3-5-sonnet",
        apiKey:    cfg().get<string>("apiKey")      ?? "",
        ollamaUrl: cfg().get<string>("ollamaUrl")  ?? "http://localhost:11434",
    };
}

export class JarvisClient {
    private _token: string | undefined;

    constructor(private ctx: vscode.ExtensionContext) {
        this._token = ctx.globalState.get<string>("jarvis.token");
    }

    setToken(t: string) {
        this._token = t;
        this.ctx.globalState.update("jarvis.token", t);
    }

    private _headers(): Record<string, string> {
        const h: Record<string, string> = { "Content-Type": "application/json" };
        if (this._token) h["Authorization"] = `Bearer ${this._token}`;
        return h;
    }

    private _request(method: string, path: string, body?: unknown): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const url  = new URL(baseUrl() + path);
            const mod  = url.protocol === "https:" ? https : http;
            const data = body ? JSON.stringify(body) : undefined;
            const req  = mod.request({
                hostname: url.hostname,
                port:     url.port || (url.protocol === "https:" ? 443 : 80),
                path:     url.pathname + url.search,
                method,
                headers:  { ...this._headers(), ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) },
            }, res => {
                let raw = "";
                res.on("data", c => raw += c);
                res.on("end", () => {
                    try { resolve(JSON.parse(raw)); }
                    catch { resolve({ raw }); }
                });
            });
            req.on("error", reject);
            if (data) req.write(data);
            req.end();
        });
    }

    async chat(messages: ChatMessage[], context?: Record<string, unknown>): Promise<string> {
        const prov = provider();
        // Route through JARVIS backend engineering chat endpoint
        const resp = await this._request("POST", "/p24/vscode/chat", {
            messages,
            context,
            ...prov,
        }) as { reply?: string; error?: string };
        if (resp.error) throw new Error(resp.error);
        return resp.reply ?? "";
    }

    async explain(code: string, lang: string, file: string): Promise<string> {
        const resp = await this._request("POST", "/p24/vscode/explain", { code, lang, file, ...provider() }) as any;
        return resp.explanation ?? resp.reply ?? "";
    }

    async generate(prompt: string, lang: string, file: string): Promise<string> {
        const resp = await this._request("POST", "/p24/vscode/generate", { prompt, lang, file, ...provider() }) as any;
        return resp.code ?? resp.reply ?? "";
    }

    async refactor(code: string, lang: string, file: string): Promise<string> {
        const resp = await this._request("POST", "/p24/vscode/refactor", { code, lang, file, ...provider() }) as any;
        return resp.refactored ?? resp.reply ?? "";
    }

    async fix(code: string, lang: string, file: string, errors: unknown[]): Promise<string> {
        const resp = await this._request("POST", "/p24/vscode/fix", { code, lang, file, errors, ...provider() }) as any;
        return resp.fixed ?? resp.reply ?? "";
    }

    async repoSearch(query: string): Promise<unknown> {
        return this._request("POST", "/p24/repo/search", { query });
    }

    async repoIndex(workspacePath: string): Promise<unknown> {
        return this._request("POST", "/p24/repo/index", { workspacePath });
    }

    async getIndexStatus(): Promise<unknown> {
        return this._request("GET", "/p24/repo/status");
    }

    async createTask(title: string): Promise<any> {
        return this._request("POST", "/p24/vscode/task", { title });
    }
}
