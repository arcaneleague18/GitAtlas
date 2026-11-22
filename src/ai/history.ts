import type { ChatMessage } from './types.js';

const size = (messages: ChatMessage[]) => Buffer.byteLength(JSON.stringify(messages), 'utf8');

/** Keep complete user turns and tool-call/result transactions within a byte budget. */
export function boundedHistory(history: ChatMessage[], maxBytes = 24000): ChatMessage[] {
  const turns: ChatMessage[][] = [];
  for (let i = 0; i < history.length; i++) {
    const message = history[i]!;
    if (message.role === 'system') continue;
    if (message.role === 'user') turns.push([]);
    const turn = turns[turns.length - 1];
    if (!turn || message.role === 'tool') continue;
    if (message.tool_calls?.length) {
      const results = history.slice(i + 1, i + 1 + message.tool_calls.length);
      if (results.length === message.tool_calls.length && message.tool_calls.every(call =>
        results.some(result => result.role === 'tool' && result.tool_call_id === call.id))) {
        turn.push(message, ...results);
      }
      i += results.filter(result => result.role === 'tool').length;
    } else turn.push(message);
  }
  const kept: ChatMessage[][] = [];
  let bytes = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!;
    const cost = size(turn);
    if (bytes + cost > maxBytes) break;
    kept.unshift(turn);
    bytes += cost;
  }
  return kept.flat();
}

export function boundedOutput(output: string, maxBytes = 8000): string {
  const bytes = Buffer.from(output, 'utf8');
  if (bytes.length <= maxBytes) return output;
  return bytes.subarray(0, maxBytes).toString('utf8') + '\n[Output truncated; narrow the request for more detail.]';
}

export function requestBytes(messages: ChatMessage[]): number { return size(messages); }
