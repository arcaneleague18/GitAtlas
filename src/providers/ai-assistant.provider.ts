/**
 * AI Assistant Sidebar Provider — serves a webview for the AI chat interface.
 *
 * Supports two AI backends:
 * 1. vscode.lm — Uses VS Code's native Language Model API (e.g., GitHub Copilot)
 * 2. openai — Uses a custom OpenAI-compatible API key from settings
 *
 * The provider injects repository context into every request so the AI
 * understands the user's current Git state.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RepositoryStateEngine } from '../engine/state-engine.js';
import { GithubIntegrationEngine } from '../engine/github-integration.js';
import { DisposableBase } from '../utils/disposable.js';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export class AiAssistantProvider
  extends DisposableBase
  implements vscode.WebviewViewProvider
{
  public static readonly viewType = 'gitTreeExplorer.aiAssistant';

  private view: vscode.WebviewView | null = null;
  private chatHistory: ChatMessage[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly stateEngine: RepositoryStateEngine,
    private readonly githubIntegration: GithubIntegrationEngine
  ) {
    super();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
      ],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      async (message: any) => {
        switch (message.type) {
          case 'ready':
            // AI view is ready
            break;
          case 'chat-request':
            await this.handleChatRequest(message.text);
            break;
          case 'clear-chat':
            this.chatHistory = [];
            break;
        }
      },
      undefined,
      this.disposables
    );
  }

  /**
   * Handle a chat request from the webview.
   * Routes to the configured AI provider.
   */
  private async handleChatRequest(userMessage: string): Promise<void> {
    if (!this.view) return;

    // Add user message to history
    this.chatHistory.push({ role: 'user', content: userMessage });

    // Build context from the current repository state
    const context = this.buildRepositoryContext();

    // Determine provider
    const config = vscode.workspace.getConfiguration('gitTreeExplorer.ai');
    const provider = config.get<string>('provider', 'vscode-lm');

    try {
      if (provider === 'openai') {
        await this.handleOpenAiRequest(context, userMessage);
      } else {
        await this.handleVsCodeLmRequest(context, userMessage);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.postToWebview({
        type: 'chat-error',
        error: errorMessage,
      });
    }
  }

  /**
   * Handle a request using VS Code's native Language Model API.
   */
  private async handleVsCodeLmRequest(
    context: string,
    userMessage: string
  ): Promise<void> {
    // Select an available model
    const models = await vscode.lm.selectChatModels({
      vendor: 'copilot',
      family: 'gpt-4o',
    });

    let model = models[0];

    // Fallback: try any available model
    if (!model) {
      const allModels = await vscode.lm.selectChatModels();
      model = allModels[0];
    }

    if (!model) {
      this.postToWebview({
        type: 'chat-error',
        error:
          'No language model available. Please install GitHub Copilot or configure a custom API key in settings (gitTreeExplorer.ai.provider → openai).',
      });
      return;
    }

    // Build messages
    const messages = [
      vscode.LanguageModelChatMessage.User(
        this.getSystemPrompt() + '\n\n' + context
      ),
    ];

    // Add recent history (last 10 messages)
    const recentHistory = this.chatHistory.slice(-10);
    for (const msg of recentHistory) {
      if (msg.role === 'user') {
        messages.push(vscode.LanguageModelChatMessage.User(msg.content));
      } else if (msg.role === 'assistant') {
        messages.push(
          vscode.LanguageModelChatMessage.Assistant(msg.content)
        );
      }
    }

    // Stream the response
    const response = await model.sendRequest(messages, {});

    let fullResponse = '';
    for await (const chunk of response.text) {
      fullResponse += chunk;
      this.postToWebview({
        type: 'chat-response-chunk',
        chunk,
        done: false,
      });
    }

    // Signal completion
    this.postToWebview({
      type: 'chat-response-chunk',
      chunk: '',
      done: true,
    });

    // Store assistant response
    this.chatHistory.push({ role: 'assistant', content: fullResponse });
  }

  /**
   * Handle a request using a custom OpenAI-compatible API.
   */
  private async handleOpenAiRequest(
    context: string,
    _userMessage: string
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration('gitTreeExplorer.ai');
    const apiKey = config.get<string>('openaiApiKey', '');
    const model = config.get<string>('openaiModel', 'gpt-4o-mini');
    const baseUrl = config.get<string>(
      'openaiBaseUrl',
      'https://api.openai.com/v1'
    );

    if (!apiKey) {
      this.postToWebview({
        type: 'chat-error',
        error:
          'No API key configured. Set your key in Settings → Git Tree Explorer → AI → OpenAI API Key.',
      });
      return;
    }

    // Build messages for OpenAI format
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: this.getSystemPrompt() + '\n\n' + context },
    ];

    const recentHistory = this.chatHistory.slice(-10);
    for (const msg of recentHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    let fullResponse = '';
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split('\n').filter((line) => line.startsWith('data: '));

      for (const line of lines) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content ?? '';
          if (content) {
            fullResponse += content;
            this.postToWebview({
              type: 'chat-response-chunk',
              chunk: content,
              done: false,
            });
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }

    // Signal completion
    this.postToWebview({
      type: 'chat-response-chunk',
      chunk: '',
      done: true,
    });

    this.chatHistory.push({ role: 'assistant', content: fullResponse });
  }

  /**
   * Build a context string from the current repository state.
   */
  private buildRepositoryContext(): string {
    const graph = this.stateEngine.graph;
    if (!graph) return 'No repository data available.';

    const parts: string[] = ['## Current Repository State'];

    // HEAD
    parts.push(
      `- HEAD: ${graph.currentBranch ?? graph.headHash.substring(0, 7) + ' (detached)'}`
    );
    parts.push(`- State: ${graph.state}`);

    // Branches
    const branches: string[] = [];
    for (const [, node] of graph.nodes) {
      if (node.kind === 'branch') {
        branches.push(node.label);
      }
    }
    if (branches.length > 0) {
      parts.push(`- Local branches: ${branches.join(', ')}`);
    }

    // Recent commits (last 5)
    const commits: string[] = [];
    for (const [, node] of graph.nodes) {
      if (node.kind === 'commit' && commits.length < 5) {
        const d = node.data;
        if ('hash' in d && 'message' in d && 'author' in d) {
          commits.push(
            `  - ${(d.hash as string).substring(0, 7)} ${d.message} (${d.author})`
          );
        }
      }
    }
    if (commits.length > 0) {
      parts.push('- Recent commits:');
      parts.push(...commits);
    }

    // Working directory
    for (const [, node] of graph.nodes) {
      if (node.kind === 'working-directory') {
        const wd = node.data as any;
        const modifiedCount = wd.modified?.length ?? 0;
        const stagedCount = wd.staged?.length ?? 0;
        const untrackedCount = wd.untracked?.length ?? 0;
        parts.push(
          `- Working directory: ${modifiedCount} modified, ${stagedCount} staged, ${untrackedCount} untracked`
        );
        break;
      }
    }

    // GitHub context
    const ghCtx = this.githubIntegration.context;
    const prCount = Object.keys(ghCtx.pullRequests).length;
    const issueCount = ghCtx.issues.length;
    if (prCount > 0 || issueCount > 0) {
      parts.push('## GitHub Context');
      if (prCount > 0) {
        parts.push(`- Open PRs: ${prCount}`);
        for (const pr of Object.values(ghCtx.pullRequests)) {
          parts.push(`  - #${pr.number}: ${pr.title} (${pr.headBranch} → ${pr.baseBranch})`);
        }
      }
      if (issueCount > 0) {
        parts.push(`- Open Issues: ${issueCount}`);
        for (const issue of ghCtx.issues.slice(0, 5)) {
          parts.push(`  - #${issue.number}: ${issue.title}`);
        }
      }
    }

    return parts.join('\n');
  }

  /**
   * System prompt that defines the AI assistant's personality and capabilities.
   */
  private getSystemPrompt(): string {
    return `You are the Git Tree Explorer AI Assistant, an expert Git advisor embedded inside a VS Code extension.

Your role:
- Help users understand their Git repository state visually
- Explain Git concepts clearly using analogies and diagrams
- Suggest solutions for common Git problems (merge conflicts, detached HEAD, dirty working tree)
- Recommend best practices for branching, committing, and collaboration
- Explain what specific Git commands will do before the user runs them

Style:
- Be concise but thorough
- Use markdown formatting (headers, bullet points, code blocks)
- When suggesting Git commands, wrap them in \`backticks\`
- Be encouraging and supportive — Git can be intimidating

You have access to the user's current repository state which is provided below as context.
Always reference the actual state when answering questions.`;
  }

  /**
   * Send a message to the webview.
   */
  private postToWebview(message: any): void {
    this.view?.webview.postMessage(message);
  }

  /**
   * Generate the HTML content for the AI assistant webview.
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    const distPath = path.join(
      this.extensionUri.fsPath,
      'dist',
      'webview'
    );

    const indexPath = path.join(distPath, 'index.html');

    if (!fs.existsSync(indexPath)) {
      return this.getFallbackHtml();
    }

    let html = fs.readFileSync(indexPath, 'utf-8');

    // Convert local resource paths to webview URIs
    const baseUri = webview.asWebviewUri(vscode.Uri.file(distPath));

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

    html = html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`
    );

    html = html.replace(/<script /g, `<script nonce="${nonce}" `);

    // Inject a global variable to tell React which view to render
    html = html.replace(
      '</head>',
      `  <script nonce="${nonce}">window.__GITVIS_VIEW__ = 'ai';</script>\n  </head>`
    );

    return html;
  }

  private getFallbackHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Assistant</title>
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
    .message {
      text-align: center;
      opacity: 0.6;
      padding: 2rem;
      line-height: 1.6;
    }
    code {
      background: var(--vscode-textCodeBlock-background);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="message">
    Webview not built yet.<br>
    Run <code>cd webview && npm install && npm run build</code><br>
    then reload this panel.
  </div>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
