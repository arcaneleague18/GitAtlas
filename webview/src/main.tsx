/**
 * Main entry point for the Git Atlas webview.
 *
 * Mounts the React app and imports the design system styles.
 * Checks window.__GITVIS_VIEW__ to determine which app to render:
 * - 'ai' → AI Assistant chat interface
 * - default → Graph visualization
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AiAssistantApp } from './AiAssistantApp';

// Design system
import './styles/index.css';
import './styles/graph.css';
import './styles/nodes.css';
import './styles/inspector.css';
import './styles/working-directory-node.css';
import './styles/action-preview.css';
import './styles/ai-assistant.css';

declare global {
  interface Window {
    __GITVIS_VIEW__?: string;
  }
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

const isAiView = window.__GITVIS_VIEW__ === 'ai';

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    {isAiView ? <AiAssistantApp /> : <App />}
  </React.StrictMode>
);
