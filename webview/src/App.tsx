/**
 * App — Root React component for the Git Tree Explorer webview.
 *
 * Responsibilities:
 * - Listen for messages from the extension host
 * - Route graph updates, theme changes, node details, and valid actions to the store
 * - Apply theme class to the document body
 * - Signal "ready" to the extension on mount
 * - Render the GraphView
 */

import { useEffect, useCallback } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useGraphStore } from './store/graph.store';
import { useVSCodeMessage } from './hooks/useVSCodeMessage';
import { postMessage } from './vscode';
import { GraphView } from './components/GraphView';
import type { ExtensionToWebviewMessage } from './types';

export function App() {
  const {
    setGraph,
    setTheme,
    setLoading,
    selectNode,
    setNodeDetails,
    setValidActions,
    theme,
    setPreviewState,
  } = useGraphStore();

  // Handle messages from the extension host
  const handleMessage = useCallback(
    (message: ExtensionToWebviewMessage) => {
      switch (message.type) {
        case 'graph-update':
          setGraph(message.graph);
          break;
        case 'theme-change':
          setTheme(message.theme);
          break;
        case 'node-focus':
          selectNode(message.nodeId);
          break;
        case 'loading':
          setLoading(message.loading);
          break;
        case 'node-details':
          setNodeDetails(message.details);
          break;
        case 'valid-actions':
          setValidActions(message.actions);
          break;
        case 'preview-action':
          setPreviewState(message.preview);
          break;
        case 'clear-preview':
          setPreviewState(null);
          break;
      }
    },
    [setGraph, setTheme, setLoading, selectNode, setNodeDetails, setValidActions, setPreviewState]
  );

  useVSCodeMessage(handleMessage);

  // Apply theme class to body
  useEffect(() => {
    document.body.className = `theme-${theme}`;
  }, [theme]);

  // Signal ready to extension on mount
  useEffect(() => {
    postMessage({ type: 'ready' });
  }, []);

  return (
    <ReactFlowProvider>
      <GraphView />
    </ReactFlowProvider>
  );
}
