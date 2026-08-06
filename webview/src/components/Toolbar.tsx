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
    showStashes,
    setShowStashes,
    branchColors,
    remotes,
    nodes,
  } = useGraphStore();

  const [isLegendOpen, setIsLegendOpen] = useState(false);
  const [isRemotePopupOpen, setIsRemotePopupOpen] = useState(false);
  const legendRef = useRef<HTMLDivElement>(null);
  const remotePopupRef = useRef<HTMLDivElement>(null);

  const currentBranchColor = branchColors.find((b) => b.isCurrent)?.color ?? '#aaaaaa';

  // Close popups when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (legendRef.current && !legendRef.current.contains(e.target as Node)) {
        setIsLegendOpen(false);
      }
      if (remotePopupRef.current && !remotePopupRef.current.contains(e.target as Node)) {
        setIsRemotePopupOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsLegendOpen(false);
        setIsRemotePopupOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

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

  const handleToggleStashes = useCallback(() => {
    setShowStashes(!showStashes);
  }, [showStashes, setShowStashes]);

  const handleEditRemoteUrl = useCallback(() => {
    setIsRemotePopupOpen(false);
    postMessage({ type: 'edit-remote-url' });
  }, []);

  const handleRemoveRemoteUrl = useCallback(() => {
    setIsRemotePopupOpen(false);
    postMessage({ type: 'remove-remote-url' });
  }, []);

  const handleCopyRemoteUrl = useCallback((url: string) => {
    navigator.clipboard.writeText(url);
    setIsRemotePopupOpen(false);
  }, []);

  const primaryRemote = remotes.find(r => r.name === 'origin') ?? remotes[0];
  const hasStashes = nodes.some(n => n.type === 'stash' || (n.data as any)?.kind === 'stash');

  return (
    <>
      {/* Top-right toolbar */}
      <div className="graph-toolbar">
        {hasStashes && (
          <button
            className="toolbar-button text-button"
            onClick={handleToggleStashes}
            title={showStashes ? 'Hide Stashes' : 'Show Stashes'}
            style={{ padding: '0 8px', fontSize: '12px', fontWeight: 'bold' }}
          >
            {showStashes ? 'Hide Stashes' : 'Show Stashes'}
          </button>
        )}
        <div style={{ position: 'relative' }} ref={remotePopupRef}>
          <button
            className="toolbar-button"
            onClick={() => setIsRemotePopupOpen(!isRemotePopupOpen)}
            title="Remote URL Settings"
          >
            🌐
          </button>
          
          <AnimatePresence>
            {isRemotePopupOpen && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="toolbar-popover"
                style={{ top: '100%', right: 0, marginTop: '8px', minWidth: '300px', padding: '12px', display: 'flex', alignItems: 'center', gap: '12px' }}
              >
                <div style={{ fontSize: '16px', opacity: 0.8 }}>🌐</div>
                {primaryRemote ? (
                  <>
                    <a 
                      href={primaryRemote.fetchUrl} 
                      target="_blank" 
                      rel="noreferrer" 
                      style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--branch-blue)', textDecoration: 'none' }}
                      title={primaryRemote.fetchUrl}
                    >
                      {primaryRemote.fetchUrl}
                    </a>
                    <button className="toolbar-button" style={{ padding: '4px' }} onClick={() => handleCopyRemoteUrl(primaryRemote.fetchUrl)} title="Copy URL">📋</button>
                    <button className="toolbar-button" style={{ padding: '4px' }} onClick={handleEditRemoteUrl} title="Edit URL">✏️</button>
                    <button className="toolbar-button" style={{ padding: '4px' }} onClick={handleRemoveRemoteUrl} title="Remove Remote">🔗<span style={{ position: 'absolute', transform: 'rotate(-45deg)', fontSize: '14px', pointerEvents: 'none' }}>/</span></button>
                  </>
                ) : (
                  <>
                    <span style={{ flex: 1, color: 'var(--text-secondary)' }}>No remote configured</span>
                    <button className="toolbar-button" style={{ padding: '4px' }} onClick={handleEditRemoteUrl} title="Add Remote">➕</button>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="toolbar-separator" />
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
        <div className="status-item" title={`Repository is ${repositoryState}`}>
          <div
            className="status-dot branch-color-dot"
            style={{
              backgroundColor: currentBranchColor,
              boxShadow: `0 0 6px ${currentBranchColor}aa`,
            }}
          />
          <span>
            {currentBranch ?? 'detached'}{' '}
            {repositoryState === 'dirty' && '✏️'}
            {repositoryState !== 'clean' && repositoryState !== 'dirty' && '⚠️'}
          </span>
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
