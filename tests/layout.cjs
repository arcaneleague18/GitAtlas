const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { patchDagre } = require('../webview/dagre-stack-safe.cjs');

async function loadLayout(patched) {
  const result = await esbuild.build({
    entryPoints: ['webview/src/layouts/dagre.ts'], bundle: true, write: false,
    platform: 'node', format: 'cjs',
    plugins: patched ? [{ name: 'dagre-patches', setup(build) {
      build.onLoad({ filter: /[\\/]node_modules[\\/](dagre|graphlib)[\\/].*\.js$/ }, ({ path: filename }) => ({
        contents: patchDagre(fs.readFileSync(filename, 'utf8'), filename), loader: 'js',
      }));
    } }] : [],
  });
  const mod = new Module(path.resolve('layout-test.cjs'));
  mod.paths = module.paths;
  mod._compile(result.outputFiles[0].text, path.resolve('layout-test.cjs'));
  return mod.exports.computeLayout;
}

function history(count, merges = false) {
  const nodes = Array.from({ length: count }, (_, i) => ({ id: `commit-${i}`, position: { x: 0, y: 0 }, data: { message: `Commit ${i}` } }));
  const edges = [];
  for (let i = 0; i < count - 1; i++) {
    edges.push({ id: `${i}->${i + 1}`, source: nodes[i].id, target: nodes[i + 1].id });
    if (merges && i % 11 === 0 && i + 4 < count) {
      edges.push({ id: `${i}->${i + 4}`, source: nodes[i].id, target: nodes[i + 4].id });
    }
  }
  return { nodes, edges };
}

test('patched Dagre produces identical positions and edge routing to the existing UI', async () => {
  const original = await loadLayout(false);
  const patched = await loadLayout(true);
  for (const count of [1, 20, 100]) {
    for (const merges of [false, true]) {
      const { nodes, edges } = history(count, merges);
      // Include disconnected, stash/working-directory-like nodes and a missing boundary.
      nodes.push({ id: 'disconnected', position: { x: 0, y: 0 }, data: {} });
      edges.push({ id: 'boundary', source: nodes[count - 1].id, target: 'not-loaded' });
      for (const options of [{}, { nodeSep: 500, rankSep: 95 }]) {
        assert.deepEqual(patched(nodes, edges, options), original(nodes, edges, options));
      }
    }
  }
  // Genuine parallel lanes: diamond merges, divergent roots, and independent tips.
  const nodes = history(9).nodes;
  const edges = [[0, 1], [0, 2], [1, 3], [2, 3], [4, 3], [4, 5], [5, 6], [7, 6]]
    .map(([a, b]) => ({ id: `${a}->${b}`, source: nodes[a].id, target: nodes[b].id }));
  assert.deepEqual(patched(nodes, edges), original(nodes, edges));
});

test('Dagre lays out 10,000 commits without recursive stack overflow', async () => {
  const layout = await loadLayout(true);
  const { nodes, edges } = history(10000);
  const result = layout(nodes, edges);
  assert.equal(result.nodes.length, nodes.length);
  for (let i = 0; i < result.nodes.length; i++) {
    const { x, y } = result.nodes[i].position;
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
    if (i) assert.ok(y > result.nodes[i - 1].position.y);
  }
  assert.ok(result.edges.every(edge => edge.data.points.length >= 2));
});

test('Dagre handles a large merge-heavy history', async () => {
  const layout = await loadLayout(true);
  const { nodes, edges } = history(2000, true);
  const result = layout(nodes, edges);
  assert.equal(result.nodes.length, 2000);
  const positions = new Map(result.nodes.map(node => [node.id, node.position]));
  for (const edge of result.edges) {
    assert.ok(positions.get(edge.source).y < positions.get(edge.target).y);
    assert.ok(edge.data.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
  }
});
