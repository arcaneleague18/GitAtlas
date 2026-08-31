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
import { SearchIcon, GlobeIcon, DeleteIcon, EditIcon, CopyIcon } from '../../../resources/icons';


interface FileSearchCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

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
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ filePath: string; commits: FileSearchCommit[] } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isConfirmingPurge, setIsConfirmingPurge] = useState<string | null>(null);
  const [isPurging, setIsPurging] = useState<string | null>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const remotePopupRef = useRef<HTMLDivElement>(null);
  const searchPopupRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const currentBranchColor = branchColors.find((b) => b.isCurrent)?.color ?? '#aaaaaa';

  // Listen for search results and purge results from extension
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'file-search-results') {
        setSearchResults({ filePath: msg.filePath, commits: msg.commits });
        setIsSearching(false);
      } else if (msg.type === 'file-purge-started') {
        setIsConfirmingPurge(null);
        setIsPurging(msg.filePath);
      } else if (msg.type === 'file-purge-cancelled') {
        setIsConfirmingPurge(null);
      } else if (msg.type === 'file-purge-result') {
        setIsPurging(null);
        if (msg.success) {
          // File is purged — update results to show empty
          setSearchResults(prev => prev ? { ...prev, commits: [] } : null);
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Close popups when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (legendRef.current && !legendRef.current.contains(e.target as Node)) {
        setIsLegendOpen(false);
      }
      if (remotePopupRef.current && !remotePopupRef.current.contains(e.target as Node)) {
        setIsRemotePopupOpen(false);
      }
      if (searchPopupRef.current && !searchPopupRef.current.contains(e.target as Node)) {
        setIsSearchOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsLegendOpen(false);
        setIsRemotePopupOpen(false);
        setIsSearchOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Focus search input when popup opens
  useEffect(() => {
    if (isSearchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isSearchOpen]);

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

  const handleSearchSubmit = useCallback(() => {
    const query = searchQuery.trim();
    if (!query) return;
    setIsSearching(true);
    setSearchResults(null);
    postMessage({ type: 'search-file-in-history', filePath: query });
  }, [searchQuery]);

  const handlePurgeFile = useCallback((filePath: string) => {
    setIsConfirmingPurge(filePath);
    postMessage({ type: 'purge-file-from-history', filePath });
  }, []);

  const handleToggleSearch = useCallback(() => {
    setIsSearchOpen(prev => {
      if (!prev) {
        setSearchQuery('');
        setSearchResults(null);
      }
      return !prev;
    });
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

        {/* File History Search */}
        <div style={{ position: 'relative' }} ref={searchPopupRef}>
          <button
            className={`toolbar-button ${isSearchOpen ? 'active' : ''}`}
            onClick={handleToggleSearch}
            title="Search File in History"
            style={{ fontSize: '14px' }}
          >
            <img src={SearchIcon} style={{ width: '1.5em', height: '1.5em' }} alt="Search" />
          </button>

          <AnimatePresence>
            {isSearchOpen && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="file-search-popup"
              >
                <div className="file-search-header">
                  <span className="file-search-title"><img src={SearchIcon} style={{ width: '1.5em', height: '1.5em', verticalAlign: 'middle', marginRight: '6px' }} alt="Search" />Search File in History</span>
                </div>
                <div className="file-search-input-row">
                  <input
                    ref={searchInputRef}
                    className="file-search-input"
                    type="text"
                    placeholder="e.g. .env, config/secrets.json"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSearchSubmit();
                      e.stopPropagation();
                    }}
                  />
                  <button
                    className="file-search-btn"
                    onClick={handleSearchSubmit}
                    disabled={isSearching || !searchQuery.trim()}
                    title={isSearching ? 'Searching...' : !searchQuery.trim() ? 'Enter a file path to search' : 'Search for file in history'}
                  >
                    {isSearching ? '...' : 'Search'}
                  </button>
                </div>

                {/* Results */}
                {searchResults && (
                  <div className="file-search-results">
                    {searchResults.commits.length === 0 ? (
                      <div className="file-search-empty">
                        No commits found containing "<strong>{searchResults.filePath}</strong>"
                      </div>
                    ) : (
                      <>
                        <div className="file-search-results-header">
                          <span>
                            Found in <strong>{searchResults.commits.length}</strong> commit{searchResults.commits.length !== 1 ? 's' : ''}
                          </span>
                          <button
                            className="file-search-purge-btn danger"
                            onClick={() => handlePurgeFile(searchResults.filePath)}
                            disabled={isPurging !== null || isConfirmingPurge !== null}
                            title={isPurging !== null ? 'Purge in progress...' : isConfirmingPurge !== null ? 'Waiting for confirmation...' : 'Permanently remove this file from all history'}
                          >
                            {isPurging === searchResults.filePath ? '⏳ Purging...' : 
                             isConfirmingPurge === searchResults.filePath ? '⏳ Confirming...' :
                             <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><img src={DeleteIcon} style={{ width: '1.5em', height: '1.5em' }} alt="Delete" /> Purge from History</span>}
                          </button>
                        </div>

                        {/* Command Preview for Search */}
                        <div className="file-search-commands">
                          <div className="file-search-commands-label">Commands</div>
                          <div className="file-search-commands-block">
                            <div className="file-search-command-line">
                              <span className="file-search-command-prompt">$</span>
                              <code>git log --all --pretty=format:"%H %h %s %an %aI" -- {searchResults.filePath}</code>
                            </div>
                          </div>
                        </div>

                        <div className="file-search-commit-list">
                          {searchResults.commits.map((c) => (
                            <div key={c.hash} className="file-search-commit">
                              <span className="file-search-commit-hash">{c.shortHash}</span>
                              <span className="file-search-commit-msg" title={c.message}>{c.message}</span>
                              <span className="file-search-commit-author">{c.author}</span>
                              <span className="file-search-commit-date">
                                {new Date(c.date).toLocaleDateString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div style={{ position: 'relative' }} ref={remotePopupRef}>
          <button
            className="toolbar-button"
            onClick={() => setIsRemotePopupOpen(!isRemotePopupOpen)}
            title="Remote URL Settings"
          >
            <img src={GlobeIcon} style={{ width: '1.2em', height: '1.2em' }} alt="Globe" />
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
                <div style={{ fontSize: '16px', opacity: 0.8, display: 'flex', alignItems: 'center' }}><img src={GlobeIcon} style={{ width: '1.2em', height: '1.2em' }} alt="Globe" /></div>
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
                    <button className="toolbar-button" style={{ padding: '4px' }} onClick={() => handleCopyRemoteUrl(primaryRemote.fetchUrl)} title="Copy URL"><img src={CopyIcon} style={{ width: '1.2em', height: '1.2em' }} alt="Copy" /></button>
                    <button className="toolbar-button" style={{ padding: '4px' }} onClick={handleEditRemoteUrl} title="Edit URL"><img src={EditIcon} style={{ width: '1.2em', height: '1.2em' }} alt="Edit" /></button>
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

      {/* Full-Screen Purge Loading Overlay */}
      <AnimatePresence>
        {isPurging && (
          <motion.div
            className="file-purge-loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="file-purge-loading-container">
              <div className="morphing-spinner" />
              <div className="file-purge-status">Rewriting history...</div>
              <div className="file-search-commands-block">
                <div className="file-search-command-line">
                  <span className="file-search-command-prompt">$</span>
                  <code>git stash push -u -m "auto-stash before purge"</code>
                </div>
                <div className="file-search-command-line">
                  <span className="file-search-command-prompt">$</span>
                  <code>git filter-branch --force --index-filter "git rm --cached --ignore-unmatch {isPurging}" --prune-empty --tag-name-filter cat -- --all</code>
                </div>
                <div className="file-search-command-line">
                  <span className="file-search-command-prompt">$</span>
                  <code>git stash pop</code>
                </div>
                <div className="file-search-command-line">
                  <span className="file-search-command-prompt">$</span>
                  <code>git reflog expire --expire=now --all</code>
                </div>
                <div className="file-search-command-line">
                  <span className="file-search-command-prompt">$</span>
                  <code>git gc --prune=now --aggressive</code>
                </div>
                <div className="file-search-command-line">
                  <span className="file-search-command-prompt">$</span>
                  <code>git push origin &lt;branch&gt; --force</code>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export const Toolbar = React.memo(ToolbarComponent);
