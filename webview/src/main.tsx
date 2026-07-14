/**
 * Main entry point for the Git Tree Explorer webview.
 *
 * Mounts the React app and imports the design system styles.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

// Design system
import './styles/index.css';
import './styles/graph.css';
import './styles/nodes.css';
import './styles/inspector.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
