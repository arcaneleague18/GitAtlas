import { boundedOutput, requestBytes } from './history.js';
import { READ_ONLY_TOOLS, DANGEROUS_TOOLS, validateTool } from './tools.js';
import { cancellable, checkCancelled, type ChatMessage, type ModelAdapter, type ToolArgs, type ToolCall, type ToolResult } from './types.js';

interface RunnerOptions {
  messages: ChatMessage[];
  adapter: ModelAdapter;
  signal: AbortSignal;
  emit: (event: Record<string, unknown>) => void;
  prepare: (name: string, args: ToolArgs) => Promise<ToolArgs>;
  approve: (name: string, args: ToolArgs, dangerous: boolean) => Promise<boolean>;
  execute: (name: string, args: ToolArgs) => Promise<ToolResult>;
  refresh: () => Promise<string>;
  maxRounds?: number;
  requestTimeoutMs?: number;
}

/** Shared policy/execution loop; provider adapters only translate wire formats. */
export async function runAgent(options: RunnerOptions): Promise<'completed' | 'denied' | 'limited'> {
  const { messages, signal, emit } = options;
  let callsMade = 0;
  let outstanding: ToolCall[] = [];
  const record = (call: ToolCall, result: ToolResult) => {
    const output = boundedOutput(result.output);
    messages.push({ role: 'tool', content: result.success ? output : `Error: ${output}`, tool_call_id: call.id, name: call.function.name });
    outstanding = outstanding.filter(item => item.id !== call.id);
    emit({ type: 'tool-call-result', id: call.id, success: result.success, output });
  };
  try {
    for (let round = 0; round < (options.maxRounds ?? 10); round++) {
      checkCancelled(signal);
      if (requestBytes(messages) > 64000) throw new Error('Conversation input budget reached. Start a new request with a narrower scope.');
      if (round) emit({ type: 'chat-response-new' });
      const requestController = new AbortController();
      const abort = () => requestController.abort();
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, options.requestTimeoutMs ?? 90000);
      let reply;
      try {
        reply = await cancellable(options.adapter(messages, requestController.signal, chunk => {
          if (!requestController.signal.aborted) emit({ type: 'chat-response-chunk', chunk, done: false });
        }), requestController.signal);
      } catch (error) {
        if (!signal.aborted && requestController.signal.aborted) throw new Error('The AI request timed out. No pending actions were executed.');
        throw error;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
      checkCancelled(signal);
      if (reply.content || !reply.toolCalls.length) emit({ type: 'chat-response-chunk', chunk: '', done: true });
      else emit({ type: 'dismiss-streaming' });
      // Reject malformed call IDs before adding an invalid transaction to history.
      const ids = reply.toolCalls.map(call => call.id);
      if (ids.some(id => !id || id.length > 200) || new Set(ids).size !== ids.length) throw new Error('The model returned invalid or duplicate tool call IDs.');
      messages.push({ role: 'assistant', content: reply.content, ...(reply.toolCalls.length ? { tool_calls: reply.toolCalls } : {}) });
      if (!reply.toolCalls.length) return 'completed';
      outstanding = [...reply.toolCalls];
      let skipReason = '';
      let denied = false;
      for (const call of reply.toolCalls) {
        checkCancelled(signal);
        if (skipReason) { record(call, { success: false, output: skipReason }); continue; }
        if (++callsMade > 30) { skipReason = 'Tool budget reached. Remaining actions were skipped.'; record(call, { success: false, output: skipReason }); continue; }
        try {
          const name = call.function.name;
          const args = await cancellable(options.prepare(name, validateTool(name, JSON.parse(call.function.arguments))), signal);
          checkCancelled(signal);
          const toolCall = { id: call.id, name, args, reason: args.reason, isDangerous: DANGEROUS_TOOLS.has(name) };
          if (!READ_ONLY_TOOLS.has(name)) {
            emit({ type: 'tool-call-request', toolCall });
            // Consent applies only to this exact prepared action and arguments.
            const approved = await cancellable(options.approve(name, args, toolCall.isDangerous), signal);
            checkCancelled(signal);
            if (!approved) {
              denied = true;
              skipReason = 'User denied permission. Remaining actions were skipped.';
              record(call, { success: false, output: skipReason });
              continue;
            }
          }
          emit({ type: 'tool-call-executing', toolCall });
          // Do not race Git mutations against cancellation: keep the repository lock
          // until the in-flight command settles, then prevent subsequent actions.
          const result = await options.execute(name, args);
          record(call, result);
          if (result.cancelled) {
            denied = true;
            skipReason = 'User cancelled the action. Remaining actions were skipped.';
          }
          if (!READ_ONLY_TOOLS.has(name)) {
            const context = await options.refresh();
            messages[0] = { ...messages[0]!, content: context };
          }
          checkCancelled(signal);
          if (!result.success && !skipReason) skipReason = 'Skipped because the preceding action failed. Inspect repository state before retrying.';
        } catch (error) {
          if (signal.aborted) throw error;
          skipReason = 'Skipped because the preceding action failed validation or execution.';
          record(call, { success: false, output: error instanceof Error ? error.message : String(error) });
        }
      }
      if (denied) return 'denied';
      if (callsMade > 30) return 'limited';
    }
    return 'limited';
  } finally {
    // Cancellation/network errors must never leave dangling tool calls in history.
    for (const call of [...outstanding]) record(call, { success: false, output: 'Run stopped. This action was not completed; inspect repository state before retrying.' });
  }
}
