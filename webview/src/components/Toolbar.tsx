/**
 * Toolbar — Graph controls (fit view, zoom, refresh).
 *
 * Positioned in the top-right corner of the graph view.
 * Provides quick access to view manipulation and refresh.
 */

import React, { useCallback, useState, useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { motion, AnimatePresence } from 'framer-motion';
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
    branchColors,
  } = useGraphStore();

  const [isLegendOpen, setIsLegendOpen] = useState(false);
  const legendRef = useRef<HTMLDivElement>(null);

  // Close legend popup when clicking outside or pressing Escape
  useEffect(() => {
    if (!isLegendOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (legendRef.current && !legendRef.current.contains(e.target as Node)) {
        setIsLegendOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsLegendOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isLegendOpen]);

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

        {/* Clickable Branches Status Item with Legend Popover */}
        <div className="status-item clickable-branches-item" ref={legendRef}>
          <button
            className={`status-branches-btn ${isLegendOpen ? 'active' : ''}`}
            onClick={() => setIsLegendOpen((prev) => !prev)}
            title="Click to toggle branch color legend"
          >
            <span>{branchCount} branches</span>
            <span className="branches-chevron">{isLegendOpen ? '▲' : '▼'}</span>
          </button>

          {/* Branch Color Legend Popover */}
          <AnimatePresence>
            {isLegendOpen && (
              <motion.div
                className="branch-legend-popover"
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              >
                <div className="popover-header">
                  <span className="popover-title">Branch Colors</span>
                  <span className="popover-count">{branchColors?.length ?? 0}</span>
                </div>
                <div className="popover-branch-list">
                  {branchColors && branchColors.length > 0 ? (
                    branchColors.map((b) => (
                      <div
                        key={b.name}
                        className={`popover-branch-item ${b.isCurrent ? 'current' : ''}`}
                      >
                        <span
                          className="popover-branch-dot"
                          style={{
                            backgroundColor: b.color,
                            boxShadow: `0 0 6px ${b.color}aa`,
                          }}
                        />
                        <span className="popover-branch-name" title={b.name}>
                          {b.name}
                        </span>
                        {b.isCurrent && <span className="popover-tag head">HEAD</span>}
                        {b.isRemote && <span className="popover-tag remote">Remote</span>}
                      </div>
                    ))
                  ) : (
                    <div className="popover-empty">No branches found</div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="status-item toggle-item">
          <label
            className="toggle-label"
            title="Show orphaned commits (reflog) for time-travel recovery"
          >
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
