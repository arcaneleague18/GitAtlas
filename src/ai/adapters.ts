import * as vscode from 'vscode';
import { readSseData } from '../utils/sse.js';
import { TOOL_DEFINITIONS } from './tools.js';
import { checkCancelled, type ModelAdapter, type ToolCall } from './types.js';

export function nativeAdapter(model: vscode.LanguageModelChat): ModelAdapter {
  return async (messages, signal, onText) => {
    const native = messages.map(message => {
      if (message.role === 'tool') return vscode.LanguageModelChatMessage.User([
        new vscode.LanguageModelToolResultPart(message.tool_call_id!, [new vscode.LanguageModelTextPart(message.content)]),
      ]);
      if (message.role === 'assistant') {
        const parts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
        if (message.content) parts.push(new vscode.LanguageModelTextPart(message.content));
        for (const call of message.tool_calls ?? []) parts.push(new vscode.LanguageModelToolCallPart(call.id, call.function.name, JSON.parse(call.function.arguments)));
        return vscode.LanguageModelChatMessage.Assistant(parts);
      }
      return vscode.LanguageModelChatMessage.User(message.content);
    });
    const cancellation = new vscode.CancellationTokenSource();
    const abort = () => cancellation.cancel();
    signal.addEventListener('abort', abort, { once: true });
    try {
      checkCancelled(signal);
      if (typeof model.countTokens === 'function') {
        let tokens = await model.countTokens(JSON.stringify(TOOL_DEFINITIONS), cancellation.token);
        for (const message of native) tokens += await model.countTokens(message, cancellation.token);
        if (tokens > model.maxInputTokens - 1024) throw new Error('Conversation exceeds this model’s input budget. Clear chat or narrow the request.');
      }
      const response = await model.sendRequest(native, {
        tools: TOOL_DEFINITIONS.map(tool => ({ name: tool.function.name, description: tool.function.description, inputSchema: tool.function.parameters })),
        toolMode: vscode.LanguageModelChatToolMode.Auto,
      }, cancellation.token);
      let content = '';
      const toolCalls: ToolCall[] = [];
      for await (const chunk of response.stream) {
        checkCancelled(signal);
        if (chunk instanceof vscode.LanguageModelTextPart) { content += chunk.value; onText(chunk.value); }
        else if (chunk instanceof vscode.LanguageModelToolCallPart) toolCalls.push({ id: chunk.callId, type: 'function', function: { name: chunk.name, arguments: JSON.stringify(chunk.input) } });
        if (content.length + JSON.stringify(toolCalls).length > 64000) throw new Error('Model response exceeded the output budget.');
      }
      return { content, toolCalls };
    } finally {
      signal.removeEventListener('abort', abort);
      cancellation.dispose();
    }
  };
}

export function compatibleAdapter(config: { baseUrl: string; apiKey: string; model: string }): ModelAdapter {
  const url = new URL(config.baseUrl.replace(/\/+$/, '') + '/chat/completions');
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('The AI provider URL must use HTTP or HTTPS.');
  return async (messages, signal, onText) => {
    const response = await fetch(url, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify({ model: config.model, messages: messages.map(message => ({ ...message, content: message.tool_calls?.length && !message.content ? null : message.content })), tools: TOOL_DEFINITIONS, tool_choice: 'auto', stream: true }),
    });
    if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}. Check the provider, model and credentials.`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('The AI provider returned no response body.');
    let content = '';
    let complete = false;
    const buffers = new Map<number, ToolCall>();
    for await (const data of readSseData(reader)) {
      checkCancelled(signal);
      if (data === '[DONE]') { complete = true; continue; }
      const parsed = JSON.parse(data);
      if (parsed.error) throw new Error('The AI provider reported a streaming error.');
      const choice = parsed.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) {
        if (!['stop', 'tool_calls'].includes(choice.finish_reason)) throw new Error('The AI response was interrupted or exceeded its output limit. No pending actions were executed.');
        complete = true;
      }
      const delta = choice.delta;
      if (!delta) continue;
      if (typeof delta.content === 'string') { content += delta.content; onText(delta.content); }
      for (const fragment of delta.tool_calls ?? []) {
        if (!Number.isInteger(fragment.index) || fragment.index < 0 || fragment.index > 30) throw new Error('Invalid streamed tool call index.');
        let call = buffers.get(fragment.index);
        if (!call) { call = { id: '', type: 'function', function: { name: '', arguments: '' } }; buffers.set(fragment.index, call); }
        if (fragment.id) call.id += fragment.id;
        if (fragment.function?.name) call.function.name += fragment.function.name;
        if (fragment.function?.arguments) call.function.arguments += fragment.function.arguments;
      }
      if (content.length + JSON.stringify([...buffers.values()]).length > 64000) throw new Error('Model response exceeded the output budget.');
    }
    checkCancelled(signal);
    if (!complete) throw new Error('AI response ended unexpectedly. No pending actions were executed.');
    return { content, toolCalls: [...buffers.entries()].sort(([a], [b]) => a - b).map(([, call]) => call) };
  };
}
