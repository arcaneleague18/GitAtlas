import * as vscode from 'vscode';
import type { GitService } from '../services/git.service.js';
import * as path from 'path';

/**
 * Provides read-only documents for Git files at specific commits.
 * 
 * URI Scheme: gitvis
 * URI Path: The file path relative to repo root, or absolute (will be resolved)
 * URI Query: ?ref=hash
 */
export class GitContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  static readonly scheme = 'gitvis';
  
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;
  private disposables: vscode.Disposable[] = [];

  constructor(private gitService: GitService) {
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, this)
    );
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    try {
      const { ref, filePath } = JSON.parse(uri.query);
      if (!ref || !filePath) {
        return '';
      }

      // We expect filePath to already be relative to the repository root
      const content = await this.gitService.show(ref, filePath);
      return content;
    } catch (e) {
      // If the file doesn't exist at this ref (e.g. newly added file), return empty string.
      // This allows vscode.diff to show it as an added file.
      return '';
    }
  }

  dispose() {
    this._onDidChange.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
