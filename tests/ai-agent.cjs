const test = require('node:test');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const Module = require('node:module');
const path = require('node:path');

async function load() {
  const result = await esbuild.build({
    stdin: { contents: `export * from './src/ai/runner'; export * from './src/ai/tools'; export * from './src/ai/history'; export * from './src/ai/adapters'; export * from './src/engine/commit-guard'; export * from './src/providers/ai-assistant.provider'; export * from './src/services/git.service';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'vscode', setup(build) {
      build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'mock' }));
      build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'module.exports = globalThis.__aiVscode;' }));
    } }],
  });
  const mod = new Module(path.resolve('ai-test.cjs'));
  mod.paths = module.paths;
  mod._compile(result.outputFiles[0].text, path.resolve('ai-test.cjs'));
  return mod.exports;
}

let api;
const approvals = [];
class TextPart { constructor(value) { this.value = value; } }
class ToolPart { constructor(callId, name, input) { Object.assign(this, { callId, name, input }); } }
class ResultPart { constructor(callId, content) { Object.assign(this, { callId, content }); } }
globalThis.__aiVscode = {
  Uri: { joinPath: () => ({}) },
  workspace: { onDidChangeConfiguration: () => ({ dispose() {} }), getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
  window: { showWarningMessage: async () => approvals.shift() },
  CancellationTokenSource: class { token = { isCancellationRequested: false }; cancel() { this.token.isCancellationRequested = true; } dispose() {} },
  LanguageModelTextPart: TextPart, LanguageModelToolCallPart: ToolPart, LanguageModelToolResultPart: ResultPart,
  LanguageModelChatMessage: { User: content => ({ role: 'user', content }), Assistant: content => ({ role: 'assistant', content }) },
  LanguageModelChatToolMode: { Auto: 0 },
};
test.before(async () => { api = await load(); });

const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify({ reason: 'test', ...args }) } });
function setup(replies, extra = {}) {
  const messages = [{ role: 'system', content: 'system' }, { role: 'user', content: 'task' }];
  const events = [], writes = [], approved = [];
  const controller = new AbortController();
  const options = { messages, signal: controller.signal, emit: event => events.push(event),
    adapter: async (_messages, _signal, onText) => { const reply = replies.shift() ?? { content: 'Finished', toolCalls: [] }; if (reply.content) onText(reply.content); return reply; },
    prepare: async (_name, args) => args,
    approve: async name => { approved.push(name); return true; },
    execute: async name => { writes.push(name); return { success: true, output: 'ok' }; },
    refresh: async () => 'updated context', ...extra };
  return { options, messages, events, writes, approved, controller };
}

test('each write, including history rewrite and stash deletion, requires its own approval', async () => {
  const state = setup([{ content: '', toolCalls: [call('1', 'stage_files', { files: ['a.txt'] }), call('2', 'delete_commit', { hash: 'abc1234' }), call('3', 'drop_stash', { index: 0 })] }]);
  assert.equal(await api.runAgent(state.options), 'completed');
  assert.deepEqual(state.approved, ['stage_files', 'delete_commit', 'drop_stash']);
  assert.ok(api.DANGEROUS_TOOLS.has('delete_commit') && api.DANGEROUS_TOOLS.has('reword_commit') && api.DANGEROUS_TOOLS.has('drop_stash'));
});

test('denial stops the batch and produces matched results for every skipped call', async () => {
  const state = setup([{ content: '', toolCalls: [call('1', 'stage_files', { files: ['a'] }), call('2', 'delete_commit', { hash: 'abc' })] }], { approve: async () => false });
  assert.equal(await api.runAgent(state.options), 'denied');
  assert.deepEqual(state.writes, []);
  assert.deepEqual(state.messages.filter(message => message.role === 'tool').map(message => message.tool_call_id), ['1', '2']);
});

test('malformed and option-like arguments never reach Git', async () => {
  for (const args of [{ hash: '', new_message: 'message', reason: 'test' }, { hash: '--all', new_message: 'message', reason: 'test' }]) {
    assert.throws(() => api.validateTool('reword_commit', args));
  }
  for (const file of ['../outside', 'C:/outside', '/outside', ':(glob)**']) assert.throws(() => api.validateTool('stage_files', { files: [file], reason: 'test' }));
  for (const max_count of [-1, 1.5, 101, '20']) assert.throws(() => api.validateTool('get_log', { max_count, reason: 'test' }));
  const state = setup([{ content: '', toolCalls: [{ id: '1', type: 'function', function: { name: 'reset', arguments: '{' } }] }]);
  await api.runAgent(state.options);
  assert.deepEqual(state.writes, []);
  assert.deepEqual(state.approved, []);
});

test('loop exhaustion returns an explicit terminal status', async () => {
  const state = setup(Array.from({ length: 2 }, (_, i) => ({ content: '', toolCalls: [call(String(i), 'get_status', {})] })), { maxRounds: 2 });
  assert.equal(await api.runAgent(state.options), 'limited');
  assert.equal(state.messages.filter(message => message.role === 'tool').length, 2);
});

test('cancellation during approval prevents late approval from executing', async () => {
  let approve, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const state = setup([{ content: '', toolCalls: [call('1', 'delete_commit', { hash: 'abc' })] }], { approve: () => { entered(); return new Promise(resolve => { approve = resolve; }); } });
  const run = api.runAgent(state.options);
  await ready;
  state.controller.abort();
  await assert.rejects(run, /cancelled/);
  approve(true);
  assert.deepEqual(state.writes, []);
  assert.equal(state.messages.at(-1).role, 'tool');
});

test('a stalled model request times out without leaving pending work', async () => {
  const state = setup([], { adapter: () => new Promise(() => {}), requestTimeoutMs: 5 });
  await assert.rejects(api.runAgent(state.options), /timed out/);
  assert.deepEqual(state.writes, []);
});

test('history truncation keeps complete transactions and drops orphan results', () => {
  const assistant = { role: 'assistant', content: '', tool_calls: [call('1', 'get_status', {})] };
  const result = { role: 'tool', content: 'status', tool_call_id: '1' };
  assert.deepEqual(api.boundedHistory([result, { role: 'user', content: 'new' }]), [{ role: 'user', content: 'new' }]);
  assert.deepEqual(api.boundedHistory([{ role: 'user', content: 'task' }, assistant, result]), [{ role: 'user', content: 'task' }, assistant, result]);
  assert.deepEqual(api.boundedHistory([{ role: 'user', content: 'task' }, assistant]), [{ role: 'user', content: 'task' }]);
  const kept = api.boundedHistory([{ role: 'user', content: 'x'.repeat(1000) }, { role: 'assistant', content: 'old' }, { role: 'user', content: 'new' }], 200);
  assert.deepEqual(kept, [{ role: 'user', content: 'new' }]);
});

test('shared commit guard refuses implicit staging, secrets denial and changed index', async () => {
  let committed = 0;
  const git = { getStatus: async () => ({ staged: [], conflicted: [] }), checkSensitiveFiles: () => [], exec: async () => 'index', createCommit: async () => { committed++; } };
  await assert.rejects(api.commitStagedWithGuard(git, 'message'), /No staged/);
  git.getStatus = async () => ({ staged: [{ path: '.env' }], conflicted: [] });
  git.checkSensitiveFiles = () => [{ path: '.env', description: 'secrets' }];
  approvals.push(undefined);
  assert.equal(await api.commitStagedWithGuard(git, 'message'), false);
  assert.equal(committed, 0);
  approvals.push('Continue Anyway');
  assert.equal(await api.commitStagedWithGuard(git, 'message'), true);
  assert.equal(committed, 1);
  let reads = 0;
  git.exec = async () => String(++reads);
  approvals.push('Continue Anyway');
  await assert.rejects(api.commitStagedWithGuard(git, 'message'), /changed during approval/);
  assert.equal(committed, 1);
});

test('status reports conflict-only repositories and short hashes resolve before exact HEAD comparison', async () => {
  const fullHash = 'a'.repeat(40), rewritten = [];
  const git = { getStatus: async () => ({ staged: [], modified: [], untracked: [], conflicted: [{ path: 'conflict.txt' }] }), getRepositoryState: async () => 'merging', getHead: async () => ({ hash: fullHash }), exec: async () => fullHash, rewordCommitMessage: async (...args) => rewritten.push(args) };
  const agent = new api.AiAssistantProvider({}, { graph: null }, {}, git);
  const result = await agent.executeTool('get_status', {}, new AbortController().signal);
  assert.match(result.output, /Conflicted: conflict.txt/);
  assert.doesNotMatch(result.output, /clean/);
  const args = await agent.prepareTool('reword_commit', { hash: 'aaaaaaa', new_message: 'new', reason: 'test' });
  await agent.executeTool('reword_commit', args, new AbortController().signal);
  assert.deepEqual(rewritten[0], [fullHash, 'new', true]);
});

test('file operations pass literal pathspecs and option boundaries', async () => {
  const git = new api.GitService('/unused', { appendLine() {} });
  const commands = [];
  git.exec = async args => { commands.push(args); return ''; };
  await git.stageFile('--all');
  await git.discardFile('[literal].txt');
  assert.deepEqual(commands[0], ['--literal-pathspecs', 'add', '--', '--all']);
  assert.deepEqual(commands[1], ['--literal-pathspecs', 'restore', '--', '[literal].txt']);
});

test('compatible adapter reconstructs streamed tool arguments and rejects incomplete responses', async () => {
  const originalFetch = globalThis.fetch;
  const event = object => 'data: ' + JSON.stringify(object) + '\n\n';
  const adapter = api.compatibleAdapter({ baseUrl: 'http://localhost:4000/v1', apiKey: '', model: 'test' });
  try {
    const body = event({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'get_status', arguments: '{"reason":' } }] } }] })
      + event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"inspect"}' } }] }, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n';
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
      for (const byte of new TextEncoder().encode(body)) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } }));
    const reply = await adapter([], new AbortController().signal, () => {});
    assert.equal(reply.toolCalls[0].function.arguments, '{"reason":"inspect"}');
    globalThis.fetch = async () => new Response(event({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'delete_commit', arguments: '{"hash":' } }] } }] }));
    await assert.rejects(adapter([], new AbortController().signal, () => {}), /ended unexpectedly/);
  } finally { globalThis.fetch = originalFetch; }
});

test('provider holds its lock through a running Git command and completes after cancellation', async () => {
  let started, release;
  const ready = new Promise(resolve => { started = resolve; });
  const events = [];
  const head = { hash: 'a'.repeat(40) };
  const status = { staged: [], modified: [], untracked: [], conflicted: [] };
  const git = { getHead: async () => head, getStatus: async () => status, stageFile: async () => { started(); await new Promise(resolve => { release = resolve; }); } };
  const engine = { graph: null, buildGraph: async () => {} };
  const agent = new api.AiAssistantProvider({}, engine, {}, git);
  agent.view = { webview: { postMessage: event => events.push(event) } };
  agent.createAdapter = async () => async () => ({ content: '', toolCalls: [call('1', 'stage_files', { files: ['a', 'b'] })] });
  globalThis.__aiVscode.window.showInformationMessage = async () => 'Execute Action';
  const running = agent.handleChatRequest('stage files', 'run-1');
  await ready;
  agent.activeRun.controller.abort();
  await agent.handleChatRequest('another task', 'run-2');
  assert.ok(events.some(event => event.type === 'chat-request-rejected' && event.runId === 'run-2'));
  assert.equal(events.some(event => event.type === 'run-completed' && event.runId === 'run-1'), false);
  release();
  await running;
  assert.equal(agent.activeRun, null);
  assert.ok(events.some(event => event.type === 'run-completed' && event.runId === 'run-1' && event.status === 'cancelled'));
});

test('native adapter preserves tool transactions and passes a cancellation token', async () => {
  let received, token;
  const model = { maxInputTokens: 100000, countTokens: async () => 1, sendRequest: async (messages, _options, cancellationToken) => {
    received = messages;
    token = cancellationToken;
    return { stream: (async function* () { yield new TextPart('Looking'); yield new ToolPart('call-2', 'get_status', { reason: 'inspect' }); })() };
  } };
  const adapter = api.nativeAdapter(model);
  const reply = await adapter([
    { role: 'user', content: 'task' },
    { role: 'assistant', content: '', tool_calls: [call('call-1', 'get_status', {})] },
    { role: 'tool', tool_call_id: 'call-1', content: 'status' },
  ], new AbortController().signal, () => {});
  assert.equal(received[1].content[0].callId, 'call-1');
  assert.equal(received[2].content[0].callId, 'call-1');
  assert.equal(reply.toolCalls[0].id, 'call-2');
  assert.equal(token.isCancellationRequested, false);
});

test('clear chat cancels the host run and invalidates its conversation generation', async () => {
  let receive;
  const agent = new api.AiAssistantProvider({}, { graph: null }, {}, {});
  agent.getHtmlForWebview = () => '';
  agent.resolveWebviewView({ webview: { onDidReceiveMessage: callback => { receive = callback; } } });
  const controller = new AbortController();
  agent.activeRun = { id: 'old-run', controller };
  agent.chatHistory = [{ role: 'user', content: 'old conversation' }];
  const generation = agent.chatGeneration;
  await receive({ type: 'clear-chat', runId: 'old-run' });
  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(agent.chatHistory, []);
  assert.equal(agent.chatGeneration, generation + 1);
});
