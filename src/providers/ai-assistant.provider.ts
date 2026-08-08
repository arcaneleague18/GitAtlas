/**
 * AI Assistant Sidebar Provider — serves a webview for the AI chat interface.
 *
 * Supports two AI backends:
 * 1. vscode.lm — Uses VS Code's native Language Model API (e.g., GitHub Copilot)
 * 2. openai — Uses a custom OpenAI-compatible API key from settings
 *
 * Agentic capabilities:
 * - The AI can request execution of git operations via tool calls
 * - Every tool call is shown as an interactive confirmation card in the chat
 * - User must approve each action before it runs
 * - The AI explains its reasoning for each tool call
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
import type { GitService } from '../services/git.service.js';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface PendingToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
  reason: string;
  isDangerous: boolean;
}

// ── Tool Definitions ─────────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'checkout',
      description: 'Switch to a different branch or detach HEAD at a commit. Use for branch switching or checking out specific commits.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Branch name or commit hash to checkout' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['ref', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_branch',
      description: 'Create a new branch, optionally at a specific commit.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name for the new branch' },
          ref: { type: 'string', description: 'Optional commit hash or branch to create from (defaults to HEAD)' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['name', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_branch',
      description: 'Delete a branch. Warning: this permanently removes the branch reference.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Branch name to delete' },
          force: { type: 'boolean', description: 'Force delete even if not fully merged (default: false)' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['name', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'merge',
      description: 'Merge a branch or commit into the current branch.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Branch name or commit hash to merge in' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['ref', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'rebase',
      description: 'Rebase the current branch onto another branch or commit.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Branch or commit hash to rebase onto' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['ref', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'cherry_pick',
      description: 'Apply changes from a specific commit onto the current branch.',
      parameters: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: 'Commit hash to cherry-pick' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['hash', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'revert',
      description: 'Create a new commit that undoes the changes of a specific commit.',
      parameters: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: 'Commit hash to revert' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['hash', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'reset',
      description: 'Reset the current branch to a specific commit. WARNING: hard reset will discard all uncommitted changes.',
      parameters: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: 'Commit hash to reset to' },
          mode: { type: 'string', enum: ['soft', 'mixed', 'hard'], description: 'Reset mode: soft (keep staged), mixed (unstage), or hard (discard all)' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['hash', 'mode', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_tag',
      description: 'Create a tag at a specific commit.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Tag name (e.g. v1.0.0)' },
          ref: { type: 'string', description: 'Optional commit hash (defaults to HEAD)' },
          message: { type: 'string', description: 'Optional tag message (creates an annotated tag)' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['name', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_tag',
      description: 'Delete a tag.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Tag name to delete' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['name', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_commit',
      description: 'Delete a commit from the history of the current branch.',
      parameters: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: 'Commit hash to delete' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['hash', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'push',
      description: 'Push local commits to the remote repository.',
      parameters: {
        type: 'object',
        properties: {
          branch: { type: 'string', description: 'Optional specific branch to push (defaults to current)' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'fetch_remote',
      description: 'Fetch updates from the remote repository without merging.',
      parameters: {
        type: 'object',
        properties: {
          remote: { type: 'string', description: 'Optional specific remote (defaults to all)' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'commit',
      description: 'Create a commit with the currently staged files. If nothing is staged, stages everything first.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Commit message' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['message', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'stage_files',
      description: 'Stage specific files or all files for commit.',
      parameters: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'string' }, description: 'File paths to stage. Use ["*"] to stage all files.' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['files', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'unstage_files',
      description: 'Unstage specific files or all files.',
      parameters: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'string' }, description: 'File paths to unstage. Use ["*"] to unstage all files.' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['files', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'discard_changes',
      description: 'Discard all uncommitted changes to a specific file. WARNING: this cannot be undone.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'File path to discard changes for' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['file', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_stash',
      description: 'Stash the current working directory changes.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Optional stash message' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_status',
      description: 'Get the current working directory status (staged, modified, untracked files). Use this to inspect the repo state before suggesting actions.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Brief explanation of why this information is needed' },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_log',
      description: 'Get recent commit history. Use this to look up commit hashes, inspect history, or find specific commits.',
      parameters: {
        type: 'object',
        properties: {
          max_count: { type: 'number', description: 'Number of commits to fetch (default: 10)' },
          reason: { type: 'string', description: 'Brief explanation of why this information is needed' },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_diff',
      description: 'Get the diff statistics for a specific commit showing which files changed and how many lines were added/removed.',
      parameters: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: 'Commit hash to get diff for' },
          reason: { type: 'string', description: 'Brief explanation of why this information is needed' },
        },
        required: ['hash', 'reason'],
      },
    },
  },
];

/** Tool names that are read-only and safe to auto-approve */
const READ_ONLY_TOOLS = new Set(['get_status', 'get_log', 'get_diff']);

/** Tool names that are destructive and need extra warning */
const DANGEROUS_TOOLS = new Set(['reset', 'delete_branch', 'delete_tag', 'discard_changes']);


export class AiAssistantProvider
  extends DisposableBase
  implements vscode.WebviewViewProvider {
  public static readonly viewType = 'gitTreeExplorer.aiAssistant';

  private view: vscode.WebviewView | null = null;
  private chatHistory: ChatMessage[] = [];

  /**
   * When the AI makes a tool call, we pause streaming, store the pending
   * tool call context here, and wait for user approval  // Removed pendingToolContext since we will use native modals
   */

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly stateEngine: RepositoryStateEngine,
    private readonly githubIntegration: GithubIntegrationEngine,
    private readonly gitService: GitService
  ) {
    super();

    // Listen for provider configuration changes to automatically fill the base URL
    this.register(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('gitTreeExplorer.ai.provider')) {
          const config = vscode.workspace.getConfiguration('gitTreeExplorer.ai');
          const provider = config.get<string>('provider');
          let newBaseUrl = '';

          switch (provider) {
            case 'openrouter':
              newBaseUrl = 'https://openrouter.ai/api/v1';
              break;
            case 'groq':
              newBaseUrl = 'https://api.groq.com/openai/v1';
              break;
            case 'nvidia':
              newBaseUrl = 'https://integrate.api.nvidia.com/v1';
              break;
            case 'ollama':
              newBaseUrl = 'http://localhost:11434/v1';
              break;
            case 'openai':
              newBaseUrl = 'https://api.openai.com/v1';
              break;
          }

          if (newBaseUrl) {
            void config.update('baseUrl', newBaseUrl, vscode.ConfigurationTarget.Global);
          }
        }
      })
    );
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
      if (provider !== 'vscode-lm') {
        await this.handleCompatibleRequest(provider, context, userMessage);
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
   * Supports full agentic tool calling via vscode.lm's LanguageModelChatTool API.
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

    // Convert our TOOL_DEFINITIONS to vscode.LanguageModelChatTool format
    const vscodeLmTools: vscode.LanguageModelChatTool[] = TOOL_DEFINITIONS.map(td => ({
      name: td.function.name,
      description: td.function.description,
      inputSchema: td.function.parameters as any,
    }));

    // Build messages
    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(
        this.getSystemPrompt() + '\n\n' + context
      ),
    ];

    // Add recent history (last 20 messages) — reconstruct from chatHistory
    const recentHistory = this.chatHistory.slice(-20);
    for (const msg of recentHistory) {
      if (msg.role === 'user') {
        messages.push(vscode.LanguageModelChatMessage.User(msg.content));
      } else if (msg.role === 'assistant') {
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          // Reconstruct assistant message with tool call parts
          const parts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
          if (msg.content) {
            parts.push(new vscode.LanguageModelTextPart(msg.content));
          }
          for (const tc of msg.tool_calls) {
            let input: Record<string, any> = {};
            try { input = JSON.parse(tc.function.arguments); } catch { /* ignore */ }
            parts.push(new vscode.LanguageModelToolCallPart(tc.id, tc.function.name, input));
          }
          messages.push(vscode.LanguageModelChatMessage.Assistant(parts));
        } else {
          messages.push(vscode.LanguageModelChatMessage.Assistant(msg.content));
        }
      } else if (msg.role === 'tool') {
        // Tool results go as User messages with LanguageModelToolResultPart
        messages.push(
          vscode.LanguageModelChatMessage.User([
            new vscode.LanguageModelToolResultPart(msg.tool_call_id!, [
              new vscode.LanguageModelTextPart(msg.content),
            ]),
          ])
        );
      }
    }

    // Agentic loop: keep calling the model until no more tool calls
    let loopCount = 0;
    const MAX_LOOPS = 10;

    while (loopCount < MAX_LOOPS) {
      loopCount++;

      // Send request with tools
      const response = await model.sendRequest(messages, {
        tools: vscodeLmTools,
        toolMode: vscode.LanguageModelChatToolMode.Auto,
      });

      // Consume the stream, collecting text parts and tool call parts
      let fullTextContent = '';
      const toolCallParts: vscode.LanguageModelToolCallPart[] = [];

      for await (const chunk of response.stream) {
        if (chunk instanceof vscode.LanguageModelTextPart) {
          fullTextContent += chunk.value;
          this.postToWebview({
            type: 'chat-response-chunk',
            chunk: chunk.value,
            done: false,
          });
        } else if (chunk instanceof vscode.LanguageModelToolCallPart) {
          toolCallParts.push(chunk);
        }
      }

      // If there are no tool calls, we're done
      if (toolCallParts.length === 0) {
        this.postToWebview({
          type: 'chat-response-chunk',
          chunk: '',
          done: true,
        });
        this.chatHistory.push({ role: 'assistant', content: fullTextContent });
        break;
      }

      // There are tool calls — finalize any text content first
      if (fullTextContent) {
        this.postToWebview({
          type: 'chat-response-chunk',
          chunk: '',
          done: true,
        });
      } else {
        this.postToWebview({ type: 'dismiss-streaming' });
      }

      // Store assistant message with tool calls in chatHistory (OpenAI format for persistence)
      const toolCallsForHistory: ToolCall[] = toolCallParts.map(tcp => ({
        id: tcp.callId,
        type: 'function' as const,
        function: {
          name: tcp.name,
          arguments: JSON.stringify(tcp.input),
        },
      }));
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: fullTextContent || '',
        tool_calls: toolCallsForHistory,
      };
      this.chatHistory.push(assistantMsg);

      // Add assistant message with tool call parts to vscode.lm messages
      const assistantParts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
      if (fullTextContent) {
        assistantParts.push(new vscode.LanguageModelTextPart(fullTextContent));
      }
      for (const tcp of toolCallParts) {
        assistantParts.push(tcp);
      }
      messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

      // Process each tool call sequentially
      for (const tcp of toolCallParts) {
        const args = (tcp.input as Record<string, any>) ?? {};
        const reason = args.reason || 'No reason provided';
        const isDangerous = DANGEROUS_TOOLS.has(tcp.name);
        const isReadOnly = READ_ONLY_TOOLS.has(tcp.name);

        // For read-only tools, auto-approve
        if (isReadOnly) {
          this.postToWebview({
            type: 'tool-call-executing',
            toolCall: { id: tcp.callId, name: tcp.name, args, reason, isDangerous: false },
          });

          const result = await this.executeTool(tcp.name, args);

          this.postToWebview({
            type: 'tool-call-result',
            id: tcp.callId,
            success: result.success,
            output: result.output,
          });

          // Add tool result to both chatHistory and vscode.lm messages
          const toolMsg: ChatMessage = {
            role: 'tool',
            content: result.success ? result.output : `Error: ${result.output}`,
            tool_call_id: tcp.callId,
            name: tcp.name,
          };
          this.chatHistory.push(toolMsg);
          messages.push(
            vscode.LanguageModelChatMessage.User([
              new vscode.LanguageModelToolResultPart(tcp.callId, [
                new vscode.LanguageModelTextPart(toolMsg.content),
              ]),
            ])
          );
          continue;
        }

        // For write operations, ask user for permission
        this.postToWebview({
          type: 'tool-call-request',
          toolCall: { id: tcp.callId, name: tcp.name, args, reason, isDangerous },
        });

        const argLines = Object.entries(args)
          .filter(([k]) => k !== 'reason')
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
          .join('\\n');

        let modalMsg = `Git Atlas AI wants to execute: ${tcp.name}\\n\\nReason: ${reason}`;
        if (argLines) {
          modalMsg += `\\n\\nParameters:\\n${argLines}`;
        }

        const choice = await vscode.window.showInformationMessage(
          modalMsg,
          { modal: true, detail: isDangerous ? 'WARNING: This is a destructive action.' : 'Are you sure you want to proceed?' },
          'Execute Action',
          'Deny'
        );

        const approved = choice === 'Execute Action';

        if (approved) {
          this.postToWebview({
            type: 'tool-call-executing',
            toolCall: { id: tcp.callId, name: tcp.name, args, reason, isDangerous },
          });

          const result = await this.executeTool(tcp.name, args);

          this.postToWebview({
            type: 'tool-call-result',
            id: tcp.callId,
            success: result.success,
            output: result.output,
          });

          try { await this.stateEngine.buildGraph(); } catch { /* ignore */ }

          const toolMsg: ChatMessage = {
            role: 'tool',
            content: result.success ? result.output : `Error: ${result.output}`,
            tool_call_id: tcp.callId,
            name: tcp.name,
          };
          this.chatHistory.push(toolMsg);
          messages.push(
            vscode.LanguageModelChatMessage.User([
              new vscode.LanguageModelToolResultPart(tcp.callId, [
                new vscode.LanguageModelTextPart(toolMsg.content),
              ]),
            ])
          );
        } else {
          const toolMsg: ChatMessage = {
            role: 'tool',
            content: 'User denied permission to execute this action.',
            tool_call_id: tcp.callId,
            name: tcp.name,
          };
          this.chatHistory.push(toolMsg);
          messages.push(
            vscode.LanguageModelChatMessage.User([
              new vscode.LanguageModelToolResultPart(tcp.callId, [
                new vscode.LanguageModelTextPart(toolMsg.content),
              ]),
            ])
          );

          this.postToWebview({
            type: 'tool-call-result',
            id: tcp.callId,
            success: false,
            output: 'Action cancelled by user.',
          });
        }
      }

      // After processing all tool calls, add a new streaming placeholder
      this.postToWebview({ type: 'chat-response-new' });

      // Loop back to call the model again with tool results
    }
  }

  /**
   * Handle a request using an OpenAI-compatible API with tool calling support.
   */
  private async handleCompatibleRequest(
    provider: string,
    context: string,
    _userMessage: string
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration('gitTreeExplorer.ai');
    const apiKey = config.get<string>('apiKey') || config.get<string>('openaiApiKey') || '';
    const model = config.get<string>('model') || config.get<string>('openaiModel') || 'gpt-4o-mini';
    const baseUrl = config.get<string>('baseUrl') || config.get<string>('customBaseUrl') || config.get<string>('openaiBaseUrl') || 'https://api.openai.com/v1';

    if (!apiKey && provider !== 'ollama') {
      this.postToWebview({
        type: 'chat-error',
        error:
          `No API key configured for ${provider}. Set your key in Settings → Git Atlas → AI → API Key.`,
      });
      return;
    }

    // Build messages for OpenAI format
    const messages: ChatMessage[] = [
      { role: 'system', content: this.getSystemPrompt() + '\n\n' + context },
    ];

    const recentHistory = this.chatHistory.slice(-20);
    for (const msg of recentHistory) {
      messages.push(msg);
    }

    // Agentic loop: keep calling the API until no more tool calls
    let loopCount = 0;
    const MAX_LOOPS = 10; // safety limit

    while (loopCount < MAX_LOOPS) {
      loopCount++;

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: messages.map(m => {
            const msg: any = { role: m.role, content: m.content };
            if (m.tool_calls) msg.tool_calls = m.tool_calls;
            if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
            if (m.name) msg.name = m.name;
            return msg;
          }),
          tools: TOOL_DEFINITIONS,
          tool_choice: 'auto',
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      let fullContent = '';
      let toolCalls: ToolCall[] = [];
      const toolCallBuffers: Map<number, { id: string; name: string; arguments: string }> = new Map();
      const decoder = new TextDecoder();

      // Stream the response
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
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            // Handle text content
            const content = delta.content ?? '';
            if (content) {
              fullContent += content;
              this.postToWebview({
                type: 'chat-response-chunk',
                chunk: content,
                done: false,
              });
            }

            // Handle tool calls
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallBuffers.has(idx)) {
                  toolCallBuffers.set(idx, {
                    id: tc.id ?? '',
                    name: tc.function?.name ?? '',
                    arguments: '',
                  });
                }
                const buf = toolCallBuffers.get(idx)!;
                if (tc.id) buf.id = tc.id;
                if (tc.function?.name) buf.name = tc.function.name;
                if (tc.function?.arguments) buf.arguments += tc.function.arguments;
              }
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }

      // Convert buffered tool calls
      toolCalls = Array.from(toolCallBuffers.values()).map(buf => ({
        id: buf.id,
        type: 'function' as const,
        function: {
          name: buf.name,
          arguments: buf.arguments,
        },
      }));

      // If there are no tool calls, we're done
      if (toolCalls.length === 0) {
        this.postToWebview({
          type: 'chat-response-chunk',
          chunk: '',
          done: true,
        });
        this.chatHistory.push({ role: 'assistant', content: fullContent });
        break;
      }

      // There are tool calls — finalize any text content first
      // Always dismiss the streaming placeholder so it doesn't persist
      if (fullContent) {
        this.postToWebview({
          type: 'chat-response-chunk',
          chunk: '',
          done: true,
        });
      } else {
        // No text content — dismiss the empty streaming placeholder
        this.postToWebview({
          type: 'dismiss-streaming',
        });
      }

      // Store assistant message with tool calls
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: fullContent || '',
        tool_calls: toolCalls,
      };
      this.chatHistory.push(assistantMsg);
      messages.push(assistantMsg);

      // Process each tool call sequentially
      for (const tc of toolCalls) {
        let args: Record<string, any> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = {};
        }

        const reason = args.reason || 'No reason provided';
        const isDangerous = DANGEROUS_TOOLS.has(tc.function.name);
        const isReadOnly = READ_ONLY_TOOLS.has(tc.function.name);

        // For read-only tools, auto-approve but still show a notification
        if (isReadOnly) {
          this.postToWebview({
            type: 'tool-call-executing',
            toolCall: {
              id: tc.id,
              name: tc.function.name,
              args,
              reason,
              isDangerous: false,
            },
          });

          const result = await this.executeTool(tc.function.name, args);

          this.postToWebview({
            type: 'tool-call-result',
            id: tc.id,
            success: result.success,
            output: result.output,
          });

          const toolMsg: ChatMessage = {
            role: 'tool',
            content: result.success ? result.output : `Error: ${result.output}`,
            tool_call_id: tc.id,
            name: tc.function.name,
          };
          this.chatHistory.push(toolMsg);
          messages.push(toolMsg);
          continue;
        }

        // For write operations, ask user for permission
        this.postToWebview({
          type: 'tool-call-request',
          toolCall: {
            id: tc.id,
            name: tc.function.name,
            args,
            reason,
            isDangerous,
          },
        });

        // Format args for modal
        const argLines = Object.entries(args)
          .filter(([k]) => k !== 'reason')
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
          .join('\\n');
        
        let modalMsg = `Git Atlas AI wants to execute: ${tc.function.name}\\n\\nReason: ${reason}`;
        if (argLines) {
          modalMsg += `\\n\\nParameters:\\n${argLines}`;
        }

        // Wait for user approval via native modal
        const choice = await vscode.window.showInformationMessage(
          modalMsg,
          { modal: true, detail: isDangerous ? 'WARNING: This is a destructive action.' : 'Are you sure you want to proceed?' },
          'Execute Action',
          'Deny'
        );

        const approved = choice === 'Execute Action';

        if (approved) {
          // Execute the tool
          this.postToWebview({
            type: 'tool-call-executing',
            toolCall: {
              id: tc.id,
              name: tc.function.name,
              args,
              reason,
              isDangerous,
            },
          });

          const result = await this.executeTool(tc.function.name, args);

          this.postToWebview({
            type: 'tool-call-result',
            id: tc.id,
            success: result.success,
            output: result.output,
          });

          // Refresh the graph after write operations
          try {
            await this.stateEngine.buildGraph();
          } catch { /* ignore */ }

          const toolMsg: ChatMessage = {
            role: 'tool',
            content: result.success ? result.output : `Error: ${result.output}`,
            tool_call_id: tc.id,
            name: tc.function.name,
          };
          this.chatHistory.push(toolMsg);
          messages.push(toolMsg);
        } else {
          // User rejected — send rejection as tool result
          const toolMsg: ChatMessage = {
            role: 'tool',
            content: 'User denied permission to execute this action.',
            tool_call_id: tc.id,
            name: tc.function.name,
          };
          this.chatHistory.push(toolMsg);
          messages.push(toolMsg);

          this.postToWebview({
            type: 'tool-call-result',
            id: tc.id,
            success: false,
            output: 'Action cancelled by user.',
          });
        }
      }

      // After processing all tool calls, add a new streaming assistant placeholder
      // so the AI can respond to the tool results.
      this.postToWebview({
        type: 'chat-response-new',
      });

      // Loop back to call the API again with tool results
    }
  }

  // ── Tool Execution ───────────────────────────────────────────────

  /**
   * Execute a tool by name and return the result.
   */
  private async executeTool(
    name: string,
    args: Record<string, any>
  ): Promise<{ success: boolean; output: string }> {
    try {
      switch (name) {
        case 'checkout': {
          await this.gitService.checkout(args.ref);
          return { success: true, output: `Checked out '${args.ref}'.` };
        }
        case 'create_branch': {
          await this.gitService.createBranch(args.name, args.ref);
          return { success: true, output: `Created branch '${args.name}'${args.ref ? ` at ${args.ref}` : ''}.` };
        }
        case 'delete_branch': {
          await this.gitService.deleteBranch(args.name, args.force ?? false);
          return { success: true, output: `Deleted branch '${args.name}'.` };
        }
        case 'merge': {
          await this.gitService.merge(args.ref);
          return { success: true, output: `Merged '${args.ref}' into current branch.` };
        }
        case 'rebase': {
          await this.gitService.rebase(args.ref);
          return { success: true, output: `Rebased current branch onto '${args.ref}'.` };
        }
        case 'cherry_pick': {
          await this.gitService.cherryPick(args.hash);
          return { success: true, output: `Cherry-picked commit ${args.hash.substring(0, 7)}.` };
        }
        case 'revert': {
          await this.gitService.revert(args.hash);
          return { success: true, output: `Reverted commit ${args.hash.substring(0, 7)}.` };
        }
        case 'reset': {
          await this.gitService.reset(args.hash, args.mode);
          return { success: true, output: `Reset (${args.mode}) to commit ${args.hash.substring(0, 7)}.` };
        }
        case 'create_tag': {
          await this.gitService.createTag(args.name, args.ref, args.message);
          return { success: true, output: `Created tag '${args.name}'.` };
        }
        case 'delete_tag': {
          await this.gitService.deleteTag(args.name);
          return { success: true, output: `Deleted tag '${args.name}'.` };
        }
        case 'delete_commit': {
          await this.gitService.deleteCommit(args.hash);
          return { success: true, output: `Deleted commit ${args.hash.substring(0, 7)}.` };
        }
        case 'push': {
          await this.gitService.push(args.branch);
          return { success: true, output: `Pushed${args.branch ? ` branch '${args.branch}'` : ''} to remote.` };
        }
        case 'fetch_remote': {
          await this.gitService.fetch(args.remote);
          return { success: true, output: `Fetched from ${args.remote || 'all remotes'}.` };
        }
        case 'commit': {
          await this.gitService.createCommit(args.message);
          return { success: true, output: `Created commit: "${args.message}".` };
        }
        case 'apply_stash': {
          await this.gitService.applyStash(args.index);
          return { success: true, output: `Applied stash@{${args.index}}.` };
        }
        case 'pop_stash': {
          await this.gitService.popStash(args.index);
          return { success: true, output: `Popped stash@{${args.index}}.` };
        }
        case 'drop_stash': {
          await this.gitService.dropStash(args.index);
          return { success: true, output: `Dropped stash@{${args.index}}.` };
        }
        case 'stage_files': {
          const files: string[] = args.files || [];
          if (files.includes('*')) {
            await this.gitService.stageAll();
            return { success: true, output: 'Staged all files.' };
          }
          for (const f of files) {
            await this.gitService.stageFile(f);
          }
          return { success: true, output: `Staged ${files.length} file(s): ${files.join(', ')}` };
        }
        case 'unstage_files': {
          const files: string[] = args.files || [];
          if (files.includes('*')) {
            await this.gitService.unstageAll();
            return { success: true, output: 'Unstaged all files.' };
          }
          for (const f of files) {
            await this.gitService.unstageFile(f);
          }
          return { success: true, output: `Unstaged ${files.length} file(s): ${files.join(', ')}` };
        }
        case 'discard_changes': {
          await this.gitService.discardFile(args.file);
          return { success: true, output: `Discarded changes in '${args.file}'.` };
        }
        case 'create_stash': {
          await this.gitService.createStash(args.message);
          return { success: true, output: `Stashed changes${args.message ? `: "${args.message}"` : ''}.` };
        }
        case 'get_status': {
          const status = await this.gitService.getStatus();
          const parts: string[] = [];
          if (status.staged.length > 0) {
            parts.push(`Staged (${status.staged.length}): ${status.staged.map(f => `${f.path} [${f.status}]`).join(', ')}`);
          }
          if (status.modified.length > 0) {
            parts.push(`Modified (${status.modified.length}): ${status.modified.map(f => `${f.path} [${f.status}]`).join(', ')}`);
          }
          if (status.untracked.length > 0) {
            parts.push(`Untracked (${status.untracked.length}): ${status.untracked.join(', ')}`);
          }
          if (parts.length === 0) {
            parts.push('Working directory is clean.');
          }
          return { success: true, output: parts.join('\n') };
        }
        case 'get_log': {
          const count = args.max_count || 10;
          const commits = await this.gitService.getLog(count);
          const logLines = commits.slice(0, count).map(c =>
            `${c.shortHash} | ${c.author} | ${new Date(c.timestamp * 1000).toISOString().split('T')[0]} | ${c.message}`
          );
          return { success: true, output: logLines.join('\n') || 'No commits found.' };
        }
        case 'get_diff': {
          const stats = await this.gitService.getDiffStats(args.hash);
          if (stats.length === 0) {
            return { success: true, output: 'No file changes in this commit.' };
          }
          const diffLines = stats.map(f =>
            `${f.path}: +${f.insertions} -${f.deletions}${f.isBinary ? ' (binary)' : ''}`
          );
          return { success: true, output: diffLines.join('\n') };
        }
        default:
          return { success: false, output: `Unknown tool: ${name}` };
      }
    } catch (err: any) {
      const errorMsg = err.stderr || err.message || 'Unknown error';
      return { success: false, output: errorMsg };
    }
  }

  // ── Context & Prompts ────────────────────────────────────────────

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
    const localBranches: string[] = [];
    const remoteBranches: string[] = [];
    for (const [, node] of graph.nodes) {
      if (node.kind === 'branch') {
        localBranches.push(node.label);
      } else if (node.kind === 'remote-branch') {
        remoteBranches.push(node.label);
      }
    }
    if (localBranches.length > 0) {
      parts.push(`- Local branches: ${localBranches.join(', ')}`);
    }
    if (remoteBranches.length > 0) {
      parts.push(`- Remote branches: ${remoteBranches.join(', ')}`);
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

    // Stashes
    const stashes: string[] = [];
    for (const [, node] of graph.nodes) {
      if (node.kind === 'stash') {
        const d = node.data as any;
        stashes.push(`  - stash@{${d.index}}: ${d.message}`);
      }
    }
    if (stashes.length > 0) {
      parts.push('- Stashes:');
      parts.push(...stashes);
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
   * System prompt that defines the AI assistant's personality and agentic capabilities.
   */
  private getSystemPrompt(): string {
    return `You are the Git Atlas AI Assistant, an expert Git advisor embedded inside a VS Code extension.

You are an AGENTIC assistant — you can directly execute Git actions on the user's repository using the tools provided.

IMPORTANT RULES:
1. ALWAYS use tools when the user asks you to perform an action (commit, branch, merge, etc.)
2. DO NOT ask the user for permission in your text response. You MUST simply execute the tool call directly. The system will automatically pause and show an approval button to the user.
3. For EVERY tool call, you MUST provide a clear "reason" parameter explaining WHY you are performing this action.
4. Read-only tools (get_status, get_log, get_diff) will execute automatically.
5. Write operations require explicit user approval — the user will see a confirmation card with buttons.
6. For dangerous operations (reset, delete), warn the user in your text response before calling the tool.
7. You can chain multiple tool calls (e.g. stage_files then commit) — each will be confirmed individually.
8. Always reference the actual repo state (provided as context) when answering questions.
9. If you need more information before acting, use get_status or get_log first.

Style:
- Be concise but thorough
- Use markdown formatting (headers, bullet points, code blocks)
- When explaining what you did, be specific about what changed
- Be encouraging and supportive — Git can be intimidating
- After executing actions, summarize what was done

You have access to the user's current repository state which is provided below as context.`;
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
