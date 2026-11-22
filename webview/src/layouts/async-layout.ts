import type { Node, Edge } from '@xyflow/react';
import type { LayoutOptions } from './dagre';
import LayoutWorker from './layout.worker?worker&inline';

type Result = { nodes: Node[]; edges: Edge[] };
type Job = { key: string; nodes: Node[]; edges: Edge[]; options: LayoutOptions; resolve: (result: Result) => void; reject: (error: Error) => void; promise: Promise<Result> };

let worker: Worker | undefined;
let active: Job | undefined;
let pending: Job | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let cached: { key: string; result: Result } | undefined;

function applyGeometry(result: Result, nodes: Node[], edges: Edge[]): Result {
  const positions = new Map(result.nodes.map(node => [node.id, node.position]));
  const routes = new Map(result.edges.map(edge => [edge.id, edge.data?.points]));
  return {
    nodes: nodes.map(node => ({ ...node, position: positions.get(node.id)! })),
    edges: edges.map(edge => ({ ...edge, data: { ...edge.data, points: routes.get(edge.id) } })),
  };
}

function finish(error?: Error, result?: Result): void {
  clearTimeout(timer);
  const job = active;
  active = undefined;
  if (job) {
    if (error) job.reject(error);
    else if (result) {
      cached = { key: job.key, result };
      job.resolve(result);
    }
  }
  const next = pending;
  pending = undefined;
  if (next) start(next);
}

function start(job: Job): void {
  active = job;
  try {
    if (!worker) {
      worker = new LayoutWorker();
      worker.onmessage = event => {
        if (event.data.error) finish(new Error(event.data.error));
        else finish(undefined, event.data.result);
      };
      worker.onerror = event => {
        event.preventDefault();
        worker?.terminate();
        worker = undefined;
        finish(new Error(event.message || 'Graph layout worker failed'));
      };
    }
    timer = setTimeout(() => {
      worker?.terminate();
      worker = undefined;
      finish(new Error('Graph layout timed out. Try loading fewer commits.'));
    }, 60000);
    // Only geometry crosses the worker boundary, not commit metadata or UI state.
    worker.postMessage({
      nodes: job.nodes.map(({ id }) => ({ id, position: { x: 0, y: 0 }, data: {} })),
      edges: job.edges.map(({ id, source, target }) => ({ id, source, target })),
      options: job.options,
    });
  } catch (error) {
    worker?.terminate();
    worker = undefined;
    finish(error instanceof Error ? error : new Error(String(error)));
  }
}

/** One active calculation, one latest pending topology, and one cached layout. */
export function computeLayoutAsync(nodes: Node[], edges: Edge[], options: LayoutOptions = {}): Promise<Result> {
  const key = JSON.stringify([nodes.map(node => node.id), edges.map(edge => [edge.id, edge.source, edge.target]), options.nodeSep, options.rankSep]);
  if (cached?.key === key) return Promise.resolve(applyGeometry(cached.result, nodes, edges));
  const existing = active?.key === key ? active : pending?.key === key ? pending : undefined;
  if (existing) return existing.promise.then(result => applyGeometry(result, nodes, edges));
  let resolve!: Job['resolve'];
  let reject!: Job['reject'];
  const promise = new Promise<Result>((res, rej) => { resolve = res; reject = rej; });
  const job = { key, nodes, edges, options, resolve, reject, promise };
  if (active) {
    pending?.reject(new Error('Layout superseded'));
    pending = job;
  } else start(job);
  return promise.then(result => applyGeometry(result, nodes, edges));
}
