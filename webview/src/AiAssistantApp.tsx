/**
 * AiAssistantApp — Chat interface for the AI assistant sidebar.
 *
 * Features:
 * - Streaming message display with typing animation
 * - Markdown rendering for AI responses
 * - Chat history with user/assistant bubbles
 * - Input area with submit on Enter
 * - Clear chat button
 * - Premium glassmorphic design
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { postMessage } from './vscode';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

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

export function AiAssistantApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamBufferRef = useRef('');

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen for messages from the extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      switch (message.type) {
        case 'chat-response-chunk': {
          if (message.done) {
            // Capture content before clearing — React 18 batching
            // defers the updater, so the ref would be empty by then.
            const finalContent = streamBufferRef.current;
            streamBufferRef.current = '';
            // Finalize the streaming message
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === 'assistant') {
                updated[updated.length - 1] = {
                  ...last,
                  content: finalContent,
                  isStreaming: false,
                };
              }
              return updated;
            });
            setIsLoading(false);
          } else {
            streamBufferRef.current += message.chunk;
            // Update the last assistant message with new content
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === 'assistant' && last.isStreaming) {
                updated[updated.length - 1] = {
                  ...last,
                  content: streamBufferRef.current,
                };
              }
              return updated;
            });
          }
          break;
        }

        case 'chat-error': {
          setMessages((prev) => {
            // Remove the streaming placeholder if it exists
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
          <span className="ai-header-icon">✨</span>
          <span>AI Assistant</span>
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
            <div className="ai-welcome-icon">🌳</div>
            <div className="ai-welcome-title">Git Atlas AI</div>
            <div className="ai-welcome-subtitle">
              Ask me anything about your repository
            </div>
            <div className="ai-suggestions">
              {[
                'What branch am I on?',
                'Explain my recent commits',
                'How do I resolve merge conflicts?',
                'What are my open PRs?',
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
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`ai-message ${msg.role}`}
            >
              <div className="ai-message-avatar">
                {msg.role === 'user' ? '👤' : '✨'}
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
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="ai-input-area">
        <textarea
          ref={inputRef}
          className="ai-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isLoading ? 'Thinking...' : 'Ask about your repository...'}
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
