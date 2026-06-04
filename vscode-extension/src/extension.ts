"use strict";
import * as vscode from "vscode";
import { JarvisChatPanel } from "./chatPanel";
import { JarvisClient } from "./jarvisClient";
import { RepoIndexer } from "./repoIndexer";

let _client: JarvisClient;
let _indexer: RepoIndexer;

export function activate(ctx: vscode.ExtensionContext) {
    _client  = new JarvisClient(ctx);
    _indexer = new RepoIndexer(ctx, _client);

    const cfg = vscode.workspace.getConfiguration("jarvis");
    if (cfg.get("autoIndex") && vscode.workspace.workspaceFolders?.length) {
        _indexer.indexWorkspace().catch(() => {});
    }

    ctx.subscriptions.push(
        vscode.commands.registerCommand("jarvis.chat", () =>
            JarvisChatPanel.createOrShow(ctx.extensionUri, _client, "general")),

        vscode.commands.registerCommand("jarvis.repoChat", () =>
            JarvisChatPanel.createOrShow(ctx.extensionUri, _client, "repo")),

        vscode.commands.registerCommand("jarvis.fileChat", () => {
            const file = vscode.window.activeTextEditor?.document.uri.fsPath ?? "";
            JarvisChatPanel.createOrShow(ctx.extensionUri, _client, "file", { file });
        }),

        vscode.commands.registerCommand("jarvis.explainCode", () => {
            const ed  = vscode.window.activeTextEditor;
            const sel = ed?.document.getText(ed.selection) ?? "";
            const file = ed?.document.uri.fsPath ?? "";
            const lang = ed?.document.languageId ?? "";
            JarvisChatPanel.createOrShow(ctx.extensionUri, _client, "explain", { code: sel, file, lang });
        }),

        vscode.commands.registerCommand("jarvis.generateCode", async () => {
            const prompt = await vscode.window.showInputBox({ prompt: "Describe what to generate" });
            if (!prompt) return;
            const ed   = vscode.window.activeTextEditor;
            const lang = ed?.document.languageId ?? "typescript";
            const file = ed?.document.uri.fsPath ?? "";
            JarvisChatPanel.createOrShow(ctx.extensionUri, _client, "generate", { prompt, lang, file });
        }),

        vscode.commands.registerCommand("jarvis.refactorCode", () => {
            const ed   = vscode.window.activeTextEditor;
            const sel  = ed?.document.getText(ed.selection) ?? "";
            const file = ed?.document.uri.fsPath ?? "";
            const lang = ed?.document.languageId ?? "";
            JarvisChatPanel.createOrShow(ctx.extensionUri, _client, "refactor", { code: sel, file, lang });
        }),

        vscode.commands.registerCommand("jarvis.fixErrors", async () => {
            const ed = vscode.window.activeTextEditor;
            if (!ed) return;
            const diags = vscode.languages.getDiagnostics(ed.document.uri)
                .filter(d => d.severity === vscode.DiagnosticSeverity.Error)
                .map(d => ({ msg: d.message, line: d.range.start.line + 1, source: d.source }));
            const code = ed.document.getText();
            const file = ed.document.uri.fsPath;
            const lang = ed.document.languageId;
            JarvisChatPanel.createOrShow(ctx.extensionUri, _client, "fix", { code, file, lang, errors: diags });
        }),

        vscode.commands.registerCommand("jarvis.openTask", async () => {
            const title = await vscode.window.showInputBox({ prompt: "Task title" });
            if (!title) return;
            const result = await _client.createTask(title);
            vscode.window.showInformationMessage(`Task created: ${result.taskId ?? result.id ?? "OK"}`);
        }),

        vscode.commands.registerCommand("jarvis.indexRepo", () =>
            _indexer.indexWorkspace()),
    );

    vscode.window.showInformationMessage("JARVIS Engineering ready");
}

export function deactivate() {}
