/**
 * Graph Webview Panel Provider — manages the React webview panel lifecycle.
 *
 * Responsibilities:
 * - Creates/reveals a WebviewPanel hosting the React commit graph
 * - Serves the built React app from dist/webview
 * - Handles postMessage communication between extension and webview
 * - Implements Content Security Policy
 * - Syncs VS Code theme changes to the webview
 * - Supports retainContextWhenHidden for performance
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RepositoryStateEngine } from '../engine/state-engine.js';
import { getValidActions } from '../engine/action-engine.js';
import { DisposableBase } from '../utils/disposable.js';
import type { GitService } from '../services/git.service.js';
import type { ActionExecutor } from '../engine/action-executor.js';
import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
  NodeDetails,
  CommitNodeData,
} from '../engine/types.js';

export class GraphPanelProvider extends DisposableBase {
  private panel: vscode.WebviewPanel | null = null;
  private webviewReady = false;
  private pendingMessages: ExtensionToWebviewMessage[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly stateEngine: RepositoryStateEngine,
    private readonly gitService: GitService,
    private readonly actionExecutor: ActionExecutor,
  ) {
    super();

    // When graph changes, send update to webview
    this.register(
      stateEngine.onDidChangeGraph((graph) => {
        const serialized = this.stateEngine.serializeGraph(graph);
        this.postMessage({
          type: 'graph-update',
          graph: serialized,
        });
      })
    );

    // Listen for theme changes
    this.register(
      vscode.window.onDidChangeActiveColorTheme((theme) => {
        this.postMessage({
          type: 'theme-change',
          theme: this.mapThemeKind(theme.kind),
        });
      })
    );
  }

  /**
   * Create or reveal the graph webview panel.
   */
  createOrShow(): void {
    // If we already have a panel, reveal it
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Create new panel
    this.panel = vscode.window.createWebviewPanel(
      'gitTreeExplorer.graphView',
      'Git Graph',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
        ],
      }
    );

    // Set HTML content
    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewToExtensionMessage) => {
        this.handleWebviewMessage(message);
      },
      undefined,
      this.disposables
    );

    // Clean up on dispose
    this.panel.onDidDispose(
      () => {
        this.panel = null;
        this.webviewReady = false;
        this.pendingMessages = [];
      },
      undefined,
      this.disposables
    );

    // Set icon
    this.panel.iconPath = vscode.Uri.joinPath(
      this.extensionUri,
      'resources',
      'icon.svg'
    );
  }

  /**
   * Focus a specific node in the graph.
   */
  focusNode(nodeId: string): void {
    this.createOrShow();
    this.postMessage({ type: 'node-focus', nodeId });
    // Fetch and send details so the inspector doesn't hang on loading
    void this.handleNodeSelected(nodeId);
  }

  /**
   * Send a message to the webview, queueing if not ready.
   */
  private postMessage(message: ExtensionToWebviewMessage): void {
    if (!this.panel) return;

    if (!this.webviewReady) {
      this.pendingMessages.push(message);
      return;
    }

    void this.panel.webview.postMessage(message);
  }

  /**
   * Handle messages from the webview.
   */
  private async handleWebviewMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.webviewReady = true;
        // Flush pending messages
        for (const pending of this.pendingMessages) {
          if (this.panel) {
            void this.panel.webview.postMessage(pending);
          }
        }
        this.pendingMessages = [];
        // Send current graph
        if (this.stateEngine.graph) {
          const serialized = this.stateEngine.serializeGraph(
            this.stateEngine.graph
          );
          void this.panel?.webview.postMessage({
            type: 'graph-update',
            graph: serialized,
          } satisfies ExtensionToWebviewMessage);
        }
        // Send current theme
        void this.panel?.webview.postMessage({
          type: 'theme-change',
          theme: this.mapThemeKind(vscode.window.activeColorTheme.kind),
        } satisfies ExtensionToWebviewMessage);
        break;

      case 'node-selected':
        // Fire a command that other parts of the extension can listen to
        void vscode.commands.executeCommand(
          'gitTreeExplorer.nodeSelected',
          message.nodeId
        );
        // Fetch and send details + valid actions for the inspector
        void this.handleNodeSelected(message.nodeId);
        break;

      case 'request-details':
        void this.handleNodeSelected(message.nodeId);
        break;

      case 'refresh':
        void vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.SourceControl,
            title: 'Git Atlas: Fetching...',
          },
          async () => {
            try {
              this.postMessage({ type: 'loading', loading: true });
              await this.gitService.fetch();
              await this.stateEngine.buildGraph();
            } catch (err) {
              console.error('Git Atlas: Fetch failed', err);
              vscode.window.showErrorMessage('Git Atlas: Failed to fetch from remote.');
            } finally {
              this.postMessage({ type: 'loading', loading: false });
            }
          }
        );
        break;

      case 'open-file':
        void vscode.commands.executeCommand(
          'vscode.open',
          vscode.Uri.file(message.path)
        );
        break;

      case 'show-diff': {
        if (message.commitHash && message.filePath) {
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (workspaceFolder) {
            const parentRef = `${message.commitHash}~1`;
            const shortHash = message.commitHash.substring(0, 7);
            const fileName = message.filePath.split('/').pop() ?? message.filePath;
            const repoPath = vscode.Uri.joinPath(workspaceFolder.uri, message.filePath).fsPath;

            // Use our custom gitvis scheme that reads using git show directly
            const leftUri = vscode.Uri.from({
              scheme: 'gitvis',
              path: `/${message.filePath}`, // Path must have a leading slash
              query: JSON.stringify({ filePath: message.filePath, ref: parentRef }),
            });
            const rightUri = vscode.Uri.from({
              scheme: 'gitvis',
              path: `/${message.filePath}`,
              query: JSON.stringify({ filePath: message.filePath, ref: message.commitHash }),
            });

            const title = `${fileName} (${shortHash})`;
            void vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
          }
        }
        break;
      }

      case 'action-requested':
        void this.actionExecutor.handleActionRequest(
          message.action,
          message.nodeId,
          (msg) => this.postMessage(msg)
        );
        break;

      case 'toggle-lost-commits':
        this.stateEngine.setShowLostCommits(message.enabled);
        void this.stateEngine.buildGraph();
        break;

      case 'load-more':
        this.stateEngine.loadMore();
        void this.stateEngine.buildGraph();
        break;

      case 'reword-commit':
        void this.handleRewordCommit(message.hash, message.newMessage);
        break;

      case 'stage-file':
        await this.gitService.stageFile(message.path);
        await this.stateEngine.buildGraph();
        if (this.stateEngine.graph?.nodes.has('working-directory')) {
          await this.handleNodeSelected('working-directory');
        }
        break;

      case 'unstage-file':
        await this.gitService.unstageFile(message.path);
        await this.stateEngine.buildGraph();
        if (this.stateEngine.graph?.nodes.has('working-directory')) {
          await this.handleNodeSelected('working-directory');
        }
        break;

      case 'stage-all':
        await this.gitService.stageAll();
        await this.stateEngine.buildGraph();
        if (this.stateEngine.graph?.nodes.has('working-directory')) {
          await this.handleNodeSelected('working-directory');
        }
        break;

      case 'unstage-all':
        await this.gitService.unstageAll();
        await this.stateEngine.buildGraph();
        if (this.stateEngine.graph?.nodes.has('working-directory')) {
          await this.handleNodeSelected('working-directory');
        }
        break;

      case 'discard-file':
        await this.gitService.discardFile(message.path);
        await this.stateEngine.buildGraph();
        if (this.stateEngine.graph?.nodes.has('working-directory')) {
          await this.handleNodeSelected('working-directory');
        }
        break;

      case 'generate-commit-message': {
        const msg = await this.gitService.generateCommitMessage();
        this.postMessage({ type: 'commit-message-generated', message: msg });
        break;
      }

      case 'commit-staged':
        await this.gitService.createCommit(message.message);
        await this.stateEngine.buildGraph();
        vscode.window.showInformationMessage('Git Atlas: Changes committed successfully.');
        break;
    }
  }

  /**
   * Handle a node selection from the webview.
   * Fetches full details (diff stats) and computes valid actions,
   * then sends them back to the webview for the Inspector panel.
   */
  private async handleNodeSelected(nodeId: string): Promise<void> {
    const graph = this.stateEngine.graph;
    if (!graph) return;

    const node = graph.nodes.get(nodeId);
    if (!node) return;

    // Build NodeDetails
    const details: NodeDetails = {
      nodeId: node.id,
      kind: node.kind,
      label: node.label,
    };

    // For commit nodes, fetch diff stats and include commit data
    if (node.data.kind === 'commit') {
      const commitData = node.data as CommitNodeData;

      // Fetch diff stats asynchronously
      const diffStats = await this.gitService.getDiffStats(commitData.hash);
      const totalInsertions = diffStats.reduce((sum, f) => sum + f.insertions, 0);
      const totalDeletions = diffStats.reduce((sum, f) => sum + f.deletions, 0);

      const commitDetails: NodeDetails = {
        ...details,
        hash: commitData.hash,
        author: commitData.author,
        authorEmail: commitData.authorEmail,
        timestamp: commitData.timestamp,
        message: commitData.message,
        parentHashes: [...commitData.parentHashes],
        branches: [...commitData.branches],
        tags: [...commitData.tags],
        diffStats,
        totalInsertions,
        totalDeletions,
        totalFilesChanged: diffStats.length,
      };

      this.postMessage({
        type: 'node-details',
        nodeId,
        details: commitDetails,
      });
    } else if (node.data.kind === 'working-directory') {
      // Build diff stats from the working directory status
      const wdData = node.data;
      const allFiles = [
        ...wdData.staged.map(f => ({ path: f.path, insertions: 0, deletions: 0, isBinary: false })),
        ...wdData.modified.map(f => ({ path: f.path, insertions: 0, deletions: 0, isBinary: false })),
        ...wdData.untracked.map(p => ({ path: p, insertions: 0, deletions: 0, isBinary: false })),
      ];

      const wdDetails: NodeDetails = {
        ...details,
        message: `${wdData.staged.length} staged, ${wdData.modified.length} modified, ${wdData.untracked.length} untracked`,
        diffStats: allFiles,
        totalFilesChanged: allFiles.length,
        totalInsertions: 0,
        totalDeletions: 0,
        workingDirectoryStatus: {
          staged: wdData.staged,
          modified: wdData.modified,
          untracked: wdData.untracked.map((p) => ({ path: p, status: 'untracked' })),
        },
      };

      this.postMessage({
        type: 'node-details',
        nodeId,
        details: wdDetails,
      });
    } else {
      this.postMessage({
        type: 'node-details',
        nodeId,
        details,
      });
    }

    // Compute and send valid actions
    const actions = getValidActions(nodeId, graph);
    this.postMessage({
      type: 'valid-actions',
      nodeId,
      actions,
    });
  }

  /**
   * Generate the HTML content for the webview.
   * Reads the built React app and injects CSP + VS Code API script.
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    const distPath = path.join(
      this.extensionUri.fsPath,
      'dist',
      'webview'
    );

    // Read the built index.html
    const indexPath = path.join(distPath, 'index.html');

    // Check if built webview exists
    if (!fs.existsSync(indexPath)) {
      return this.getDevFallbackHtml(webview);
    }

    let html = fs.readFileSync(indexPath, 'utf-8');

    // Convert local resource paths to webview URIs
    const baseUri = webview.asWebviewUri(
      vscode.Uri.file(distPath)
    );

    // Replace relative paths with webview URIs
    html = html.replace(
      /(href|src)="\.?\/?assets\//g,
      `$1="${baseUri}/assets/`
    );

    // Inject CSP
    const nonce = getNonce();
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource} https://fonts.gstatic.com`,
      `img-src ${webview.cspSource} data:`,
      `connect-src https://fonts.googleapis.com https://fonts.gstatic.com`,
    ].join('; ');

    // Insert CSP meta tag and add nonce to scripts
    html = html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`
    );

    // Add nonce to script tags
    html = html.replace(
      /<script /g,
      `<script nonce="${nonce}" `
    );

    return html;
  }

  /**
   * Fallback HTML when the webview hasn't been built yet.
   */
  private getDevFallbackHtml(_webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Git Atlas</title>
  <style>
    body {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .title {
      font-size: 1.5rem;
      margin-bottom: 1rem;
      opacity: 0.9;
    }
    .message {
      opacity: 0.6;
      line-height: 1.6;
    }
    code {
      background: var(--vscode-textCodeBlock-background);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="title">Git Atlas</div>
    <div class="message">
      Webview not built yet.<br>
      Run <code>cd webview && npm install && npm run build</code><br>
      then reload this panel.
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Map VS Code ThemeKind to our theme type.
   */
  private mapThemeKind(
    kind: vscode.ColorThemeKind
  ): 'dark' | 'light' | 'high-contrast' {
    switch (kind) {
      case vscode.ColorThemeKind.Light:
        return 'light';
      case vscode.ColorThemeKind.HighContrast:
      case vscode.ColorThemeKind.HighContrastLight:
        return 'high-contrast';
      default:
        return 'dark';
    }
  }

  override dispose(): void {
    this.panel?.dispose();
    super.dispose();
  }

  /**
   * Handle a commit message reword request from the webview.
   */
  private async handleRewordCommit(hash: string, newMessage: string): Promise<void> {
    const graph = this.stateEngine.graph;
    if (!graph) return;

    const isHead = graph.headHash === hash;

    try {
      this.postMessage({ type: 'loading', loading: true });
      await this.gitService.rewordCommitMessage(hash, newMessage, isHead);
      await this.stateEngine.buildGraph();

      this.postMessage({
        type: 'reword-result',
        success: true,
        hash,
      } as any);

      vscode.window.showInformationMessage('Git Atlas: Commit message updated.');
    } catch (err: any) {
      const errorMessage = err.stderr?.trim() || err.message || 'Unknown error';
      this.postMessage({
        type: 'reword-result',
        success: false,
        hash,
        error: errorMessage,
      } as any);

      vscode.window.showErrorMessage(`Git Atlas: Failed to reword commit — ${errorMessage}`);
    } finally {
      this.postMessage({ type: 'loading', loading: false });
    }
  }
}

/**
 * Generate a random nonce for CSP.
 */
function getNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
