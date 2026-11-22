const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const esbuild = require('esbuild');

async function load(entry) {
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'vscode-stub', setup(build) {
      build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' }));
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = {};' }));
    } }],
  });
  const mod = new Module(path.resolve(entry));
  mod.paths = module.paths;
  mod._compile(result.outputFiles[0].text, path.resolve(entry));
  return mod.exports;
}

test('real Git status preserves spaces, Unicode, rename destinations and untracked files', async () => {
  const { GitService } = await load('src/services/git.service.ts');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-atlas-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' });
  try {
    git('init');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    fs.writeFileSync(path.join(root, 'old name.txt'), 'original');
    fs.writeFileSync(path.join(root, 'café file.txt'), 'before');
    git('add', '.');
    git('commit', '-m', 'initial');
    git('mv', 'old name.txt', 'new name.txt');
    fs.writeFileSync(path.join(root, 'café file.txt'), 'after');
    fs.writeFileSync(path.join(root, 'untracked file.txt'), 'new');
    const service = new GitService(root, { appendLine() {} });
    const status = await service.getStatus();
    assert.deepEqual(status.staged, [{ path: 'new name.txt', status: 'renamed' }]);
    assert.deepEqual(status.modified, [{ path: 'café file.txt', status: 'modified' }]);
    assert.deepEqual(status.untracked, ['untracked file.txt']);
    git('tag', 'light');
    git('tag', '-a', 'annotated', '-m', 'release');
    const head = git('rev-parse', 'HEAD').trim();
    const tags = await service.getTags();
    assert.equal(tags.length, 2);
    assert.ok(tags.every(tag => tag.targetHash === head));
    assert.equal(tags.find(tag => tag.name === 'annotated').message, 'release');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('status parser preserves control characters, whitespace and conflict paths', async () => {
  const { parseGitStatus } = await load('src/utils/git-status.ts');
  const file = ' leading\tquoted"\nname ';
  const status = parseGitStatus(`1 MM N... 100644 100644 100644 abc def ${file}\0u UU N... 100644 100644 100644 100644 abc def ghi conflict file\0? ${file}\0`);
  assert.equal(status.modified[0].path, file);
  assert.equal(status.staged[0].path, file);
  assert.equal(status.untracked[0], file);
  assert.equal(status.conflicted[0].path, 'conflict file');
});

test('SSE decoder preserves text and tool arguments across every byte boundary', async () => {
  const { readSseData } = await load('src/utils/sse.ts');
  const events = [JSON.stringify({ choices: [{ delta: { content: 'café 🌍' } }] }), JSON.stringify({ choices: [{ delta: { tool_calls: [{ function: { arguments: '{"name":"feature branch"}' } }] } }] }), '[DONE]'];
  const bytes = new TextEncoder().encode(events.map(data => `data: ${data}\r\n\r\n`).join(''));
  for (let split = 1; split < bytes.length; split++) {
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, split));
      controller.enqueue(bytes.slice(split));
      controller.close();
    } });
    const received = [];
    for await (const data of readSseData(stream.getReader())) received.push(data);
    assert.deepEqual(received, events, `split at byte ${split}`);
  }
});
