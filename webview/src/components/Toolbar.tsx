/**
 * Toolbar — Graph controls (fit view, zoom, refresh).
 *
 * Positioned in the top-right corner of the graph view.
 * Provides quick access to view manipulation and refresh.
 */

import React, { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { postMessage } from '../vscode';
import { useGraphStore } from '../store/graph.store';

function ToolbarComponent() {
  const reactFlow = useReactFlow();
  const {
    repositoryState,
    commitCount,
    branchCount,
    currentBranch,
    hasMore,
    showLostCommits,
    setShowLostCommits,
  } = useGraphStore();

  const handleFitView = useCallback(() => {
    reactFlow.fitView({ padding: 0.2, duration: 500 });
  }, [reactFlow]);

  const handleZoomIn = useCallback(() => {
    reactFlow.zoomIn({ duration: 300 });
  }, [reactFlow]);

  const handleZoomOut = useCallback(() => {
    reactFlow.zoomOut({ duration: 300 });
  }, [reactFlow]);

  const handleRefresh = useCallback(() => {
    postMessage({ type: 'refresh' });
  }, []);

  const handleToggleLostCommits = useCallback(() => {
    const newValue = !showLostCommits;
    setShowLostCommits(newValue);
    postMessage({ type: 'toggle-lost-commits', enabled: newValue });
  }, [showLostCommits, setShowLostCommits]);

  const handleLoadMore = useCallback(() => {
    postMessage({ type: 'load-more' });
  }, []);

  return (
    <>
      {/* Top-right toolbar */}
      <div className="graph-toolbar">
        <button
          className="toolbar-button"
          onClick={handleZoomIn}
          title="Zoom In"
        >
          +
        </button>
        <button
          className="toolbar-button"
          onClick={handleZoomOut}
          title="Zoom Out"
        >
          −
        </button>
        <button
          className="toolbar-button"
          onClick={handleFitView}
          title="Fit to View"
        >
          ⊡
        </button>
        <div className="toolbar-separator" />
        <button
          className="toolbar-button"
          onClick={handleRefresh}
          title="Refresh Graph"
        >
          ⟳
        </button>
      </div>

      {/* Bottom-left status bar */}
      <div className="graph-status-bar glass">
        <div className="status-item">
          <div
            className={`status-dot ${
              repositoryState === 'clean'
                ? 'clean'
                : repositoryState === 'dirty'
                ? 'dirty'
                : 'conflict'
            }`}
          />
          <span>{currentBranch ?? 'detached'}</span>
        </div>
        <div className="status-item">
          <span>{commitCount} commits</span>
        </div>
        <div className="status-item">
          <span>{branchCount} branches</span>
        </div>
        <div className="status-item toggle-item">
          <label className="toggle-label" title="Show orphaned commits (reflog) for time-travel recovery">
            <input
              type="checkbox"
              checked={showLostCommits}
              onChange={handleToggleLostCommits}
            />
            <span>Show Lost Commits</span>
          </label>
        </div>
        {hasMore && (
          <div className="status-item">
            <button className="load-more-btn" onClick={handleLoadMore}>
              Load More
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export const Toolbar = React.memo(ToolbarComponent);
