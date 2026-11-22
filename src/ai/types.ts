export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolResult { success: boolean; output: string; cancelled?: boolean }
export type ToolArgs = Record<string, unknown>;
export type ModelAdapter = (messages: ChatMessage[], signal: AbortSignal, onText: (text: string) => void) => Promise<{ content: string; toolCalls: ToolCall[] }>;

export function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Agent run cancelled.');
}

/** Abort a wait even if a provider or native approval dialog ignores cancellation. */
export async function cancellable<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  checkCancelled(signal);
  let abort!: () => void;
  const cancellation = new Promise<never>((_, reject) => {
    abort = () => reject(new Error('Agent run cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([Promise.resolve(work), cancellation]); }
  finally { signal.removeEventListener('abort', abort); }
}
