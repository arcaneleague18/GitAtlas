import { computeLayout } from './dagre';

// Vite bundles this worker as a self-contained script, with the same Dagre
// compatibility patches as the application build.
self.onmessage = (event: MessageEvent) => {
  const { nodes, edges, options } = event.data;
  try {
    self.postMessage({ result: computeLayout(nodes, edges, options) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
