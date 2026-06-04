"use strict";
import * as vscode from "vscode";
import { JarvisClient } from "./jarvisClient";

export class RepoIndexer {
    private _statusBar: vscode.StatusBarItem;

    constructor(private ctx: vscode.ExtensionContext, private client: JarvisClient) {
        this._statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
        this._statusBar.text = "$(database) JARVIS";
        this._statusBar.tooltip = "JARVIS repo index status — click to re-index";
        this._statusBar.command = "jarvis.indexRepo";
        this._statusBar.show();
        ctx.subscriptions.push(this._statusBar);
    }

    async indexWorkspace(): Promise<void> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) {
            vscode.window.showWarningMessage("JARVIS: No workspace folder open");
            return;
        }
        this._statusBar.text = "$(sync~spin) JARVIS indexing…";
        try {
            const result: any = await this.client.repoIndex(folders[0].uri.fsPath);
            const count = result?.symbolCount ?? result?.count ?? "?";
            this._statusBar.text = `$(database) JARVIS (${count} symbols)`;
            vscode.window.showInformationMessage(`JARVIS: Repo indexed — ${count} symbols`);
        } catch (e: any) {
            this._statusBar.text = "$(warning) JARVIS (index failed)";
            vscode.window.showErrorMessage(`JARVIS index failed: ${e.message}`);
        }
    }
}
