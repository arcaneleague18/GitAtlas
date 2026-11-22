const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');

async function loadScheduler() {
  const workers = [];
  globalThis.__LayoutTestWorker = class {
    constructor() { workers.push(this); this.requests = []; }
    postMessage(request) { this.requests.push(request); }
    terminate() { this.terminated = true; }
    complete() {
      const { nodes, edges } = this.requests.at(-1);
      this.onmessage({ data: { result: {
        nodes: nodes.map((node, i) => ({ ...node, position: { x: 40, y: i * 120 } })),
        edges: edges.map(edge => ({ ...edge, data: { points: [{ x: 40, y: 0 }, { x: 40, y: 120 }] } })),
      } } });
    }
  };
  const result = await esbuild.build({
    entryPoints: ['webview/src/layouts/async-layout.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'mock-worker', setup(build) {
      build.onResolve({ filter: /\?worker&inline$/ }, () => ({ path: 'worker', namespace: 'mock' }));
      build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export default globalThis.__LayoutTestWorker;' }));
    } }],
  });
  const mod = new Module(path.resolve('worker-test.cjs'));
  mod.paths = module.paths;
  mod._compile(result.outputFiles[0].text, path.resolve('worker-test.cjs'));
  return { compute: mod.exports.computeLayoutAsync, workers };
}

const nodes = [{ id: 'a', position: { x: 0, y: 0 }, data: { message: 'before' } }];

test('worker cache and in-flight sharing preserve fresh UI metadata', async () => {
  const { compute, workers } = await loadScheduler();
  const first = compute(nodes, [], {});
  const fresh = [{ ...nodes[0], data: { message: 'after', isSelected: true } }];
  const second = compute(fresh, [], {});
  assert.equal(workers.length, 1);
  assert.equal(workers[0].requests.length, 1);
  workers[0].complete();
  await first;
  assert.equal((await second).nodes[0].data.message, 'after');
  const cached = await compute(fresh, [], {});
  assert.equal(cached.nodes[0].data.isSelected, true);
  assert.equal(workers[0].requests.length, 1);
  const spacing = compute(nodes, [], { rankSep: 90 });
  assert.equal(workers[0].requests.length, 2);
  workers[0].complete();
  await spacing;
});

test('only the latest pending topology runs and failed jobs can retry', async () => {
  const { compute, workers } = await loadScheduler();
  const first = compute(nodes, [], {});
  const obsolete = compute([{ ...nodes[0], id: 'b' }], [], {});
  const rejected = assert.rejects(obsolete, /superseded/);
  const latest = compute([{ ...nodes[0], id: 'c' }], [], {});
  workers[0].complete();
  await first;
  await rejected;
  assert.equal(workers[0].requests.at(-1).nodes[0].id, 'c');
  workers[0].onmessage({ data: { error: 'layout failed' } });
  await assert.rejects(latest, /layout failed/);
  const retry = compute([{ ...nodes[0], id: 'c' }], [], {});
  workers[0].complete();
  assert.equal((await retry).nodes[0].id, 'c');
});
