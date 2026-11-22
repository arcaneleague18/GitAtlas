const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');

async function loadEngine() {
  const result = await esbuild.build({
    entryPoints: ['src/engine/state-engine.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'vscode-stub', setup(build) {
      build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'mock' }));
      build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
        export class EventEmitter {
          listeners = new Set();
          event = fn => { this.listeners.add(fn); return { dispose: () => this.listeners.delete(fn) }; };
          fire(value) { for (const listener of this.listeners) listener(value); }
          dispose() { this.listeners.clear(); }
        }
        export const workspace = { getConfiguration: () => ({ get: (key, fallback) => fallback }) };
      ` }));
    } }],
  });
  const mod = new Module(path.resolve('state-test.cjs'));
  mod.paths = module.paths;
  mod._compile(result.outputFiles[0].text, path.resolve('state-test.cjs'));
  return mod.exports.RepositoryStateEngine;
}

function gitService() {
  return {
    getHead: async () => ({ hash: '', branch: null, isDetached: false }),
    getLog: async () => [], getBranches: async () => [], getTags: async () => [],
    getStashes: async () => [], getRemotes: async () => [],
    getStatus: async () => ({ staged: [], modified: [], untracked: [], conflicted: [] }),
    getRepositoryState: async () => 'clean',
  };
}

test('unchanged polling emits no updates but working changes still do', async () => {
  const Engine = await loadEngine();
  const git = gitService();
  const engine = new Engine(git);
  let updates = 0;
  engine.onDidChangeGraph(() => updates++);
  await engine.buildGraph();
  await engine.buildGraph();
  assert.equal(updates, 1);
  git.getStatus = async () => ({ staged: [], modified: [], untracked: ['new file'], conflicted: [] });
  await engine.buildGraph();
  assert.equal(updates, 2);
  engine.dispose();
});

test('a burst of refreshes runs at most one follow-up build and recovers after failure', async () => {
  const Engine = await loadEngine();
  const git = gitService();
  let release;
  let calls = 0;
  git.getLog = () => {
    calls++;
    return calls === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve([]);
  };
  const engine = new Engine(git);
  const initial = engine.buildGraph();
  const pending = Array.from({ length: 100 }, () => engine.buildGraph());
  release([]);
  await Promise.all([initial, ...pending]);
  assert.equal(calls, 2);
  git.getLog = async () => { throw new Error('Git failed'); };
  await assert.rejects(engine.buildGraph(), /Git failed/);
  git.getLog = async () => [];
  await engine.buildGraph();
  engine.dispose();
});

test('Load More increments in bounded batches and stops advertising more at the ceiling', async () => {
  const Engine = await loadEngine();
  const git = gitService();
  let requested;
  git.getLog = async count => { requested = count; return []; };
  const engine = new Engine(git);
  engine.loadMore();
  await engine.buildGraph();
  assert.equal(requested, 1000);
  for (let i = 0; i < 100; i++) engine.loadMore();
  await engine.buildGraph();
  assert.equal(requested, 10000);
  assert.equal(engine.serializeGraph(engine.graph).hasMore, false);
  engine.dispose();
});
