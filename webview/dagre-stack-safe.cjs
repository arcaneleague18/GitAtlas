// Dagre 0.8.5 / graphlib 2.1.8 compatibility patches. Preserve DFS visitation
// order and ranking semantics, using heap-backed frames instead of recursion.
// Applied during bundling; never modifies installed packages.
function replaceFunction(source, name, replacement) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Unsupported Dagre source: ${name} missing`);
  const body = source.indexOf('{', start);
  let depth = 1, end = body + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  return source.slice(0, start) + replacement + source.slice(end);
}

const patches = {
  '/dagre/lib/acyclic.js': ['dfsFAS', `function dfsFAS(g) {
    var fas = [], visited = new Set(), active = new Set();
    g.nodes().forEach(function(root) {
      if (visited.has(root)) return;
      visited.add(root); active.add(root);
      var frames = [{v: root, edges: g.outEdges(root), i: 0}];
      while (frames.length) {
        var f = frames[frames.length - 1];
        if (f.i === f.edges.length) { active.delete(f.v); frames.pop(); continue; }
        var e = f.edges[f.i++];
        if (active.has(e.w)) fas.push(e);
        else if (!visited.has(e.w)) {
          visited.add(e.w); active.add(e.w);
          frames.push({v: e.w, edges: g.outEdges(e.w), i: 0});
        }
      }
    });
    return fas;
  }`],
  '/dagre/lib/rank/util.js': ['longestPath', `function longestPath(g) {
    var visited = new Set();
    g.sources().forEach(function(root) {
      if (visited.has(root)) return;
      visited.add(root);
      var frames = [{v: root, edges: g.outEdges(root), i: 0}];
      while (frames.length) {
        var f = frames[frames.length - 1];
        if (f.i < f.edges.length) {
          var w = f.edges[f.i++].w;
          if (!visited.has(w)) { visited.add(w); frames.push({v: w, edges: g.outEdges(w), i: 0}); }
        } else {
          var rank = Infinity;
          f.edges.forEach(function(e) { rank = Math.min(rank, g.node(e.w).rank - g.edge(e).minlen); });
          g.node(f.v).rank = rank === Infinity ? 0 : rank;
          frames.pop();
        }
      }
    });
  }`],
  '/dagre/lib/rank/feasible-tree.js': ['tightTree', `function tightTree(t, g) {
    t.nodes().forEach(function(root) {
      var frames = [{v: root, edges: g.nodeEdges(root), i: 0}];
      while (frames.length) {
        var f = frames[frames.length - 1];
        if (f.i === f.edges.length) { frames.pop(); continue; }
        var e = f.edges[f.i++], w = f.v === e.v ? e.w : e.v;
        if (!t.hasNode(w) && !slack(g, e)) {
          t.setNode(w, {}); t.setEdge(f.v, w, {});
          frames.push({v: w, edges: g.nodeEdges(w), i: 0});
        }
      }
    });
    return t.nodeCount();
  }`],
  '/dagre/lib/rank/network-simplex.js': ['dfsAssignLowLim', `function dfsAssignLowLim(tree, visited, nextLim, v, parent) {
    visited[v] = true;
    var frames = [{v: v, parent: parent, low: nextLim, neighbors: tree.neighbors(v), i: 0}];
    while (frames.length) {
      var f = frames[frames.length - 1];
      if (f.i < f.neighbors.length) {
        var w = f.neighbors[f.i++];
        if (!_.has(visited, w)) {
          visited[w] = true;
          frames.push({v: w, parent: f.v, low: nextLim, neighbors: tree.neighbors(w), i: 0});
        }
      } else {
        var label = tree.node(f.v);
        label.low = f.low; label.lim = nextLim++;
        if (f.parent) label.parent = f.parent; else delete label.parent;
        frames.pop();
      }
    }
    return nextLim;
  }`],
  '/dagre/lib/order/init-order.js': ['initOrder', `function initOrder(g) {
    var visited = new Set();
    var simpleNodes = _.filter(g.nodes(), function(v) { return !g.children(v).length; });
    var maxRank = _.max(_.map(simpleNodes, function(v) { return g.node(v).rank; }));
    var layers = _.map(_.range(maxRank + 1), function() { return []; });
    _.sortBy(simpleNodes, function(v) { return g.node(v).rank; }).forEach(function(root) {
      var stack = [root];
      while (stack.length) {
        var v = stack.pop();
        if (visited.has(v)) continue;
        visited.add(v); layers[g.node(v).rank].push(v);
        var next = g.successors(v);
        for (var i = next.length - 1; i >= 0; i--) stack.push(next[i]);
      }
    });
    return layers;
  }`],
  '/graphlib/lib/alg/dfs.js': ['doDfs', `function doDfs(g, v, postorder, visited, navigation, acc) {
    if (_.has(visited, v)) return;
    visited[v] = true;
    if (!postorder) acc.push(v);
    var frames = [{v: v, next: navigation(v), i: 0}];
    while (frames.length) {
      var f = frames[frames.length - 1];
      if (f.i === f.next.length) {
        if (postorder) acc.push(f.v);
        frames.pop(); continue;
      }
      var w = f.next[f.i++];
      if (!_.has(visited, w)) {
        visited[w] = true;
        if (!postorder) acc.push(w);
        frames.push({v: w, next: navigation(w), i: 0});
      }
    }
  }`],
};

function patchDagre(source, filename) {
  const normalized = filename.replace(/\\/g, '/');
  // Dagre otherwise scans every node for every rank. Index once, preserving
  // insertion order, and pass exactly the same candidates to its layer builder.
  if (normalized.endsWith('/dagre/lib/order/index.js')) {
    return replaceFunction(source, 'buildLayerGraphs', `function buildLayerGraphs(g, ranks, relationship) {
      var byRank = new Map();
      g.nodes().forEach(function(v) {
        var node = g.node(v);
        var first = node.minRank === undefined ? node.rank : node.minRank;
        var last = node.maxRank === undefined ? node.rank : node.maxRank;
        for (var rank = first; rank <= last; rank++) {
          if (!byRank.has(rank)) byRank.set(rank, []);
          byRank.get(rank).push(v);
        }
      });
      return _.map(ranks, function(rank) {
        return buildLayerGraph(g, rank, relationship, byRank.get(rank) || []);
      });
    }`);
  }
  if (normalized.endsWith('/dagre/lib/order/build-layer-graph.js')) {
    return source.replace('function buildLayerGraph(g, rank, relationship)', 'function buildLayerGraph(g, rank, relationship, candidates)')
      .replace('_.forEach(g.nodes(), function(v)', '_.forEach(candidates || g.nodes(), function(v)');
  }
  for (const [suffix, [name, replacement]] of Object.entries(patches)) {
    if (normalized.endsWith(suffix)) return replaceFunction(source, name, replacement);
  }
  return source;
}

module.exports = { patchDagre };
