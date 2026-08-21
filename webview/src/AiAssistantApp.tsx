/**
 * AiAssistantApp — Chat interface for the AI assistant sidebar.
 *
 * Features:
 * - Streaming message display with typing animation
 * - Markdown rendering for AI responses
 * - Chat history with user/assistant bubbles
 * - Tool call confirmation cards with reason display
 * - Input area with submit on Enter
 * - Clear chat button
 * - Premium dark-mode design
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { postMessage } from './vscode';
import AiAssistantIcon from '../../resources/icons/bloub-nuage-attentif-gris-anime.svg';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool-request' | 'tool-executing' | 'tool-result';
  content: string;
  isStreaming?: boolean;
  toolCall?: ToolCallData;
  toolResult?: { success: boolean; output: string };
}

interface ToolCallData {
  id: string;
  name: string;
  args: Record<string, any>;
  reason: string;
  isDangerous: boolean;
}

// Human-readable labels for tool names
const TOOL_LABELS: Record<string, string> = {
  switch: 'Switch',
  create_branch: 'Create Branch',
  delete_branch: 'Delete Branch',
  merge: 'Merge',
  rebase: 'Rebase',
  cherry_pick: 'Cherry Pick',
  revert: 'Revert',
  reset: 'Reset',
  create_tag: 'Create Tag',
  delete_tag: 'Delete Tag',
  push: 'Push',
  fetch_remote: 'Fetch',
  commit: 'Commit',
  stage_files: 'Stage Files',
  unstage_files: 'Unstage Files',
  discard_changes: 'Discard Changes',
  purge_file_from_history: 'Purge File from History',
  create_stash: 'Stash',
  get_status: 'Get Status',
  get_log: 'Get Log',
  get_diff: 'Get Diff',
};

const TOOL_ICONS: Record<string, string> = {
  switch: '🔀',
  create_branch: '🌿',
  delete_branch: '🗑️',
  merge: '🔗',
  rebase: '📐',
  cherry_pick: '🍒',
  revert: '↩️',
  reset: '⚠️',
  create_tag: '🏷️',
  delete_tag: '🗑️',
  push: '⬆️',
  fetch_remote: '⬇️',
  commit: '💾',
  stage_files: '📋',
  unstage_files: '📄',
  discard_changes: '🚮',
  purge_file_from_history: '🛡️',
  create_stash: '📦',
  get_status: '📊',
  get_log: '📜',
  get_diff: '📝',
};

// Simple markdown-like rendering (bold, code, headers, lists)
function renderMarkdown(text: string): string {
  return text
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="ai-code-block"><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="ai-inline-code">$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Headers
    .replace(/^### (.+)$/gm, '<h4 class="ai-heading">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="ai-heading">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="ai-heading">$1</h2>')
    // Bullet lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul class="ai-list">$&</ul>')
    // Line breaks
    .replace(/\n/g, '<br>');
}

/** Format tool args for display (excluding 'reason') */
function formatToolArgs(args: Record<string, any>): [string, string][] {
  return Object.entries(args)
    .filter(([key]) => key !== 'reason')
    .map(([key, value]) => [
      key.replace(/_/g, ' '),
      Array.isArray(value) ? value.join(', ') : String(value),
    ]);
}

export function AiAssistantApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamBufferRef = useRef('');

  // Scroll to bottom when messages change
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
    return () => clearTimeout(timeoutId);
  }, [messages]);

  // Listen for messages from the extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      switch (message.type) {
        case 'chat-response-chunk': {
          if (message.done) {
            const finalContent = streamBufferRef.current;
            streamBufferRef.current = '';
            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = findLastStreamingIndex(updated);
              if (lastIdx >= 0) {
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  content: finalContent,
                  isStreaming: false,
                };
              }
              return updated;
            });
            setIsLoading(false);
          } else {
            streamBufferRef.current += message.chunk;
            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = findLastStreamingIndex(updated);
              if (lastIdx >= 0) {
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  content: streamBufferRef.current,
                };
              }
              return updated;
            });
          }
          break;
        }

        case 'chat-response-new': {
          // A new assistant placeholder is needed after tool results
          streamBufferRef.current = '';
          setMessages((prev) => [
            ...prev,
            {
              id: `ai-${Date.now()}`,
              role: 'assistant',
              content: '',
              isStreaming: true,
            },
          ]);
          setIsLoading(true);
          break;
        }

        case 'dismiss-streaming': {
          // Remove the empty streaming placeholder when AI only returned tool calls
          streamBufferRef.current = '';
          setMessages((prev) => prev.filter((m) => !(m.isStreaming && !m.content)));
          setIsLoading(false);
          break;
        }

        case 'tool-call-request': {
          const tc = message.toolCall as ToolCallData;
          setMessages((prev) => [
            ...prev,
            {
              id: `tool-req-${tc.id}`,
              role: 'tool-request',
              content: '',
              toolCall: tc,
            },
          ]);
          // Ensure the full tool card (including buttons) is scrolled into view
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          }, 100);
          break;
        }

        case 'tool-call-executing': {
          const tc = message.toolCall as ToolCallData;
          setMessages((prev) => {
            // Replace the request card with executing state
            return prev.map((m) =>
              m.id === `tool-req-${tc.id}`
                ? { ...m, role: 'tool-executing' as const }
                : m
            );
          });
          break;
        }

        case 'tool-call-result': {
          const { id, success, output } = message;
          setMessages((prev) => {
            // Replace the executing card with result
            return prev.map((m) =>
              m.id === `tool-req-${id}`
                ? {
                    ...m,
                    role: 'tool-result' as const,
                    toolResult: { success, output },
                  }
                : m
            );
          });
          break;
        }

        case 'chat-error': {
          setMessages((prev) => {
            const updated = prev.filter((m) => !m.isStreaming);
            return [
              ...updated,
              {
                id: `err-${Date.now()}`,
                role: 'assistant' as const,
                content: `⚠️ **Error:** ${message.error}`,
              },
            ];
          });
          setIsLoading(false);
          break;
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Signal ready
  useEffect(() => {
    postMessage({ type: 'ready' } as any);
  }, []);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
    };

    const assistantPlaceholder: ChatMessage = {
      id: `ai-${Date.now()}`,
      role: 'assistant',
      content: '',
      isStreaming: true,
    };

    streamBufferRef.current = '';
    setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
    setInput('');
    setIsLoading(true);

    postMessage({ type: 'chat-request', text } as any);
  }, [input, isLoading]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleClear = useCallback(() => {
    setMessages([]);
    streamBufferRef.current = '';
    postMessage({ type: 'clear-chat' } as any);
  }, []);

  return (
    <div className="ai-assistant">
      {/* Header */}
      <div className="ai-header">
        <div className="ai-header-title">
          <span className="ai-header-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
            <img src={AiAssistantIcon} style={{ width: '3em', height: '3em' }} alt="AI Assistant" />
          </span>
          AI Assistant<span className="ai-agentic-badge">Agentic</span>
        </div>
        {messages.length > 0 && (
          <button
            className="ai-clear-btn"
            onClick={handleClear}
            title="Clear chat"
          >
            ✕
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="ai-messages">
        {messages.length === 0 ? (
          <div className="ai-welcome">
            <div className="ai-welcome-icon">🧭</div>
            <div className="ai-welcome-title">Git Atlas AI</div>
            <div className="ai-welcome-subtitle">
              I can answer questions <strong>and execute actions</strong> on your repository
            </div>
            <div className="ai-suggestions">
              {[
                'Create a feature branch',
                'Stage all files and commit',
                'What changed in the last 5 commits?',
                'Cherry-pick the latest commit from main',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  className="ai-suggestion-chip"
                  onClick={() => {
                    setInput(suggestion);
                    inputRef.current?.focus();
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            // Tool call cards
            if (msg.role === 'tool-request' || msg.role === 'tool-executing' || msg.role === 'tool-result') {
              return (
                <ToolCallCard
                  key={msg.id}
                  msg={msg}
                />
              );
            }

            // Regular chat messages
            return (
              <div
                key={msg.id}
                className={`ai-message ${msg.role}`}
              >
                <div className={`chat-bubble-avatar ${msg.role === 'user' ? 'user' : 'assistant'}`}>
                  {msg.role === 'user' ? '👤' : (
                    <img src={AiAssistantIcon} style={{ width: '1em', height: '1em' }} alt="AI Assistant" />
                  )}
                </div>
                <div className="ai-message-content">
                  {msg.role === 'assistant' ? (
                    <div
                      className={`ai-markdown ${msg.isStreaming ? 'streaming' : ''}`}
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdown(msg.content || ''),
                      }}
                    />
                  ) : (
                    <div className="ai-user-text">{msg.content}</div>
                  )}
                  {msg.isStreaming && !msg.content && (
                    <div className="ai-typing-indicator">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} style={{ height: '32px', flexShrink: 0 }} />
      </div>

      {/* Input */}
      <div className="ai-input-area">
        <textarea
          ref={inputRef}
          className="ai-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isLoading ? 'Thinking...' : 'Ask or command your repository...'}
          disabled={isLoading}
          rows={1}
        />
        <button
          className="ai-send-btn"
          onClick={handleSubmit}
          disabled={!input.trim() || isLoading}
          title="Send message"
        >
          {isLoading ? (
            <span className="ai-send-spinner" />
          ) : (
            '→'
          )}
        </button>
      </div>
    </div>
  );
}

// ── Tool Call Confirmation Card ────────────────────────────────

interface ToolCallCardProps {
  msg: ChatMessage;
}

function ToolCallCard({ msg }: ToolCallCardProps) {
  const tc = msg.toolCall;
  if (!tc) return null;

  const label = TOOL_LABELS[tc.name] || tc.name;
  const icon = TOOL_ICONS[tc.name] || '🔧';
  const params = formatToolArgs(tc.args);
  const isPending = msg.role === 'tool-request';
  const isExecuting = msg.role === 'tool-executing';
  const isDone = msg.role === 'tool-result';

  return (
    <div
      className={`ai-tool-card ${tc.isDangerous ? 'dangerous' : ''} ${
        isPending ? 'pending' : isExecuting ? 'executing' : isDone ? 'done' : ''
      } ${isDone && msg.toolResult ? (msg.toolResult.success ? 'success' : 'error') : ''}`}
    >
      {/* Header */}
      <div className="ai-tool-header">
        <span className="ai-tool-icon">{icon}</span>
        <span className="ai-tool-name">{label}</span>
        {isPending && (
          <span className="ai-tool-badge pending">Awaiting Approval</span>
        )}
        {isExecuting && (
          <span className="ai-tool-badge executing">Executing…</span>
        )}
        {isDone && msg.toolResult?.success && (
          <span className="ai-tool-badge success">✓ Done</span>
        )}
        {isDone && !msg.toolResult?.success && (
          <span className="ai-tool-badge error">✗ Failed</span>
        )}
      </div>

      {/* Reason */}
      <div className="ai-tool-reason">
        <span className="ai-tool-reason-label">Reason:</span>
        <span>{tc.reason}</span>
      </div>

      {/* Parameters */}
      {params.length > 0 && (
        <div className="ai-tool-params">
          {params.map(([key, value]) => (
            <div key={key} className="ai-tool-param">
              <span className="ai-tool-param-key">{key}</span>
              <span className="ai-tool-param-value">{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Danger warning */}
      {tc.isDangerous && isPending && (
        <div className="ai-tool-warning">
          [Warning] This is a destructive action that may not be easily undone.
        </div>
      )}

      {/* Action buttons (only for pending) */}
      {isPending && (
        <div className="ai-tool-actions" style={{ marginTop: '8px', width: '100%', textAlign: 'center' }}>
          <span style={{ fontSize: '11px', color: '#8b949e', fontStyle: 'italic' }}>
            Please check the popup in the center of your screen to approve or deny.
          </span>
        </div>
      )}

      {/* Execution spinner */}
      {isExecuting && (
        <div className="ai-tool-executing">
          <span className="ai-tool-spinner" />
          <span>Running...</span>
        </div>
      )}

      {/* Result */}
      {isDone && msg.toolResult && (
        <div className={`ai-tool-output ${msg.toolResult.success ? 'success' : 'error'}`}>
          <pre>{msg.toolResult.output}</pre>
        </div>
      )}
    </div>
  );
}

/** Find the index of the last streaming assistant message */
function findLastStreamingIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && messages[i].isStreaming) {
      return i;
    }
  }
  return -1;
}
