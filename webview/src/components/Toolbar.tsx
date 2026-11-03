/**
 * Toolbar — Graph controls (fit view, zoom, refresh).
 *
 * Positioned in the top-right corner of the graph view.
 * Provides quick access to view manipulation and refresh.
 */

import React, { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { useReactFlow } from '@xyflow/react';
import { motion, AnimatePresence } from 'framer-motion';
import { postMessage } from '../vscode';
import { useGraphStore } from '../store/graph.store';
import { SearchIcon, GlobeIcon, DeleteIcon, EditIcon, CopyIcon } from '../../../resources/icons';
import { PullModal, type PullOptions } from './PullModal';

function SearchCommitsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M11.7422 10.3439C12.5329 9.2673 13 7.9382 13 6.5C13 2.91015 10.0899 0 6.5 0C2.91015 0 0 2.91015 0 6.5C0 10.0899 2.91015 13 6.5 13C7.9385 13 9.268 12.5327 10.3448 11.7415L14.2929 15.6896C14.6834 16.0801 15.3166 16.0801 15.7071 15.6896C16.0976 15.2991 16.0976 14.6659 15.7071 14.2754L11.7422 10.3439ZM2 6.5C2 4.01472 4.01472 2 6.5 2C8.98528 2 11 4.01472 11 6.5C11 8.98528 8.98528 11 6.5 11C4.01472 11 2 8.98528 2 6.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function getCommitTimeAgo(unixTimestamp: number): string {
  if (!unixTimestamp) return '';
  const sec = unixTimestamp > 1e11 ? Math.floor(unixTimestamp / 1000) : unixTimestamp;
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - sec);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}mo ago`;
  return `${Math.floor(diff / 31536000)}y ago`;
}

function getCommitFullDate(unixTimestamp: number): string {
  if (!unixTimestamp) return '';
  const ms = unixTimestamp < 1e11 ? unixTimestamp * 1000 : unixTimestamp;
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}


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
    headHash,
    hasMore,
    showLostCommits,
    setShowLostCommits,
    showStashes,
    setShowStashes,
    branchColors,
    remotes,
    nodes,
    selectNode,
    selectedNodeId,
  } = useGraphStore();

  const [isLegendOpen, setIsLegendOpen] = useState(false);
  const [isRemotePopupOpen, setIsRemotePopupOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ filePath: string; commits: FileSearchCommit[] } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isConfirmingPurge, setIsConfirmingPurge] = useState<string | null>(null);
  const [isPurging, setIsPurging] = useState<string | null>(null);
  const [isCommitSearchOpen, setIsCommitSearchOpen] = useState(false);
  const [commitSearchQuery, setCommitSearchQuery] = useState('');
  const commitSearchPopupRef = useRef<HTMLDivElement>(null);
  const commitSearchInputRef = useRef<HTMLInputElement>(null);
  const flyAnimationRef = useRef<number | null>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const remotePopupRef = useRef<HTMLDivElement>(null);
  const searchPopupRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const rebaseDropdownRef = useRef<HTMLDivElement>(null);
  const mergeDropdownRef = useRef<HTMLDivElement>(null);
  const [isRebaseDropdownOpen, setIsRebaseDropdownOpen] = useState(false);
  const [isMergeDropdownOpen, setIsMergeDropdownOpen] = useState(false);
  const [isPullModalOpen, setIsPullModalOpen] = useState(false);

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
    const handleClickOutside = (e: MouseEvent | PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;

      if (legendRef.current && !legendRef.current.contains(target)) {
        setIsLegendOpen(false);
      }
      if (remotePopupRef.current && !remotePopupRef.current.contains(target)) {
        setIsRemotePopupOpen(false);
      }
      if (searchPopupRef.current && !searchPopupRef.current.contains(target)) {
        setIsSearchOpen(false);
      }
      if (commitSearchPopupRef.current && !commitSearchPopupRef.current.contains(target)) {
        setIsCommitSearchOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsLegendOpen(false);
        setIsRemotePopupOpen(false);
        setIsSearchOpen(false);
        setIsCommitSearchOpen(false);
      }
      // Ctrl+F or Cmd+F opens Find Commits & Tags
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        const target = e.target as HTMLElement | null;
        const isEditing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
        if (!isEditing || target === commitSearchInputRef.current) {
          e.preventDefault();
          setIsCommitSearchOpen((prev) => {
            const next = !prev;
            if (next) {
              setIsSearchOpen(false);
              setIsRemotePopupOpen(false);
              setIsLegendOpen(false);
            }
            return next;
          });
        }
      }
    };

    // Use capture phase so React Flow canvas events (which stop bubbling) are intercepted
    document.addEventListener('pointerdown', handleClickOutside, true);
    document.addEventListener('mousedown', handleClickOutside, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside, true);
      document.removeEventListener('mousedown', handleClickOutside, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Cancel any running camera animation on unmount
  useEffect(() => {
    return () => {
      if (flyAnimationRef.current !== null) {
        cancelAnimationFrame(flyAnimationRef.current);
      }
    };
  }, []);

  // Focus search input when popup opens
  useEffect(() => {
    if (isSearchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isSearchOpen]);

  // Focus commit search input when popup opens
  useEffect(() => {
    if (isCommitSearchOpen && commitSearchInputRef.current) {
      commitSearchInputRef.current.focus();
      commitSearchInputRef.current.select();
    }
  }, [isCommitSearchOpen]);

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
  }, [postMessage]);

  const handlePull = useCallback(() => {
    setIsPullModalOpen(true);
  }, []);

  const handleExecutePull = useCallback(
    (options: PullOptions) => {
      postMessage({
        type: 'pull',
        remote: options.remote,
        branch: options.branch,
        pullAll: options.pullAll,
        rebase: options.rebase,
        autostash: options.autostash,
      });
    },
    []
  );

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
      const next = !prev;
      if (next) {
        setIsCommitSearchOpen(false);
        setIsRemotePopupOpen(false);
        setIsLegendOpen(false);
      }
      return next;
    });
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults(null);
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  const handleToggleCommitSearch = useCallback(() => {
    setIsCommitSearchOpen(prev => {
      const next = !prev;
      if (next) {
        setIsSearchOpen(false);
        setIsRemotePopupOpen(false);
        setIsLegendOpen(false);
      }
      return next;
    });
  }, []);

  const handleClearCommitSearch = useCallback(() => {
    setCommitSearchQuery('');
    if (commitSearchInputRef.current) {
      commitSearchInputRef.current.focus();
    }
  }, []);

  interface SearchMatch {
    nodeId: string;
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    timestamp: number;
    color: string;
    isHead?: boolean;
    tags: readonly string[];
    branches: readonly string[];
    matchType: 'message' | 'hash' | 'tag' | 'branch';
    matchedTag?: string;
  }

  const headCommitNode = useMemo<SearchMatch | null>(() => {
    const commitNodes = nodes.filter(
      (n) => n.type === 'commit' || (n.data as any)?.kind === 'commit'
    );
    const target =
      commitNodes.find((n) => {
        const d = (n.data ?? {}) as any;
        return Boolean(d.isHead || (headHash && (n.id === headHash || d.hash === headHash)));
      }) ?? nodes.find((n) => n.id === headHash || (n.data as any)?.hash === headHash);

    if (!target) return null;
    const d = (target.data ?? {}) as any;
    const hash = d.hash ?? target.id;
    const shortHash = d.shortHash ?? (hash ? hash.substring(0, 7) : target.id.substring(0, 7));
    return {
      nodeId: target.id,
      hash,
      shortHash,
      message: d.message ?? '',
      author: d.author ?? '',
      timestamp: d.timestamp ?? 0,
      color: d.color ?? '#58a6ff',
      isHead: true,
      tags: d.tags ?? [],
      branches: d.branches ?? [],
      matchType: 'message',
    };
  }, [nodes, headHash]);

  const recentCommits = useMemo<SearchMatch[]>(() => {
    const commitNodes = nodes.filter(
      (n) => n.type === 'commit' || (n.data as any)?.kind === 'commit'
    );

    // Sort by timestamp descending
    const sorted = [...commitNodes].sort((a, b) => {
      const tA = ((a.data ?? {}) as any).timestamp ?? 0;
      const tB = ((b.data ?? {}) as any).timestamp ?? 0;
      return tB - tA;
    });

    // Exclude the head commit node if present so it doesn't duplicate
    const filtered = headCommitNode
      ? sorted.filter(
          (n) =>
            n.id !== headCommitNode.nodeId &&
            (n.data as any)?.hash !== headCommitNode.hash
        )
      : sorted;

    return filtered.slice(0, 15).map((n) => {
      const d = (n.data ?? {}) as any;
      const hash = d.hash ?? n.id;
      const shortHash = d.shortHash ?? (hash ? hash.substring(0, 7) : n.id.substring(0, 7));
      return {
        nodeId: n.id,
        hash,
        shortHash,
        message: d.message ?? '',
        author: d.author ?? '',
        timestamp: d.timestamp ?? 0,
        color: d.color ?? '#58a6ff',
        isHead: false,
        tags: d.tags ?? [],
        branches: d.branches ?? [],
        matchType: 'message',
      };
    });
  }, [nodes, headCommitNode]);

  const commitSearchResults = useMemo<SearchMatch[]>(() => {
    const q = commitSearchQuery.trim().toLowerCase();
    if (!q) return [];

    const commitNodes = nodes.filter(
      (n) => n.type === 'commit' || (n.data as any)?.kind === 'commit'
    );

    const matches: SearchMatch[] = [];

    for (const n of commitNodes) {
      const d = (n.data ?? {}) as any;
      const hash = d.hash ?? n.id;
      const shortHash = d.shortHash ?? (hash ? hash.substring(0, 7) : n.id.substring(0, 7));
      const message = d.message ?? '';
      const tags: readonly string[] = d.tags ?? [];
      const branches: readonly string[] = d.branches ?? [];

      const hashMatch = hash.toLowerCase().includes(q) || shortHash.toLowerCase().includes(q);
      const matchedTag = tags.find((t) => t.toLowerCase().includes(q));
      const tagMatch = Boolean(matchedTag);
      const msgMatch = message.toLowerCase().includes(q);
      const matchedBranch = branches.find((b) => b.toLowerCase().includes(q));
      const branchMatch = Boolean(matchedBranch);

      if (hashMatch || tagMatch || msgMatch || branchMatch) {
        let matchType: 'message' | 'hash' | 'tag' | 'branch' = 'message';
        if (tagMatch) matchType = 'tag';
        else if (hashMatch) matchType = 'hash';
        else if (branchMatch) matchType = 'branch';

        const isHead = Boolean(
          d.isHead || (headHash && (n.id === headHash || hash === headHash))
        );

        matches.push({
          nodeId: n.id,
          hash,
          shortHash,
          message,
          author: d.author ?? '',
          timestamp: d.timestamp ?? 0,
          color: d.color ?? '#58a6ff',
          isHead,
          tags,
          branches,
          matchType,
          matchedTag,
        });
      }
    }

    // Sort: HEAD commit first if matched, then tag matches, then exact hash matches, then timestamp descending
    matches.sort((a, b) => {
      if (a.isHead && !b.isHead) return -1;
      if (!a.isHead && b.isHead) return 1;

      if (a.matchType === 'tag' && b.matchType !== 'tag') return -1;
      if (b.matchType === 'tag' && a.matchType !== 'tag') return 1;

      if (a.matchType === 'hash' && b.matchType !== 'hash') return -1;
      if (b.matchType === 'hash' && a.matchType !== 'hash') return 1;

      return b.timestamp - a.timestamp;
    });

    return matches.slice(0, 50);
  }, [nodes, commitSearchQuery, headHash]);

  const handleSelectSearchCommit = useCallback(
    (commitHash: string, shortHash: string) => {
      const flowNodes = reactFlow.getNodes();
      let targetNode = flowNodes.find(
        (n) =>
          n.id === commitHash ||
          n.id === shortHash ||
          n.data?.hash === commitHash ||
          n.data?.shortHash === shortHash
      );

      if (!targetNode) {
        targetNode = nodes.find(
          (n) =>
            n.id === commitHash ||
            n.id === shortHash ||
            (n.data as any)?.hash === commitHash ||
            (n.data as any)?.shortHash === shortHash
        );
      }

      const nodeId = targetNode?.id ?? commitHash;
      selectNode(nodeId);
      postMessage({ type: 'node-selected', nodeId });

      if (targetNode) {
        // Cancel any active camera flight
        if (flyAnimationRef.current !== null) {
          cancelAnimationFrame(flyAnimationRef.current);
          flyAnimationRef.current = null;
        }

        const width = targetNode.measured?.width ?? (targetNode as any).width ?? 220;
        const height = targetNode.measured?.height ?? (targetNode as any).height ?? 80;
        const targetNodeCenterX = targetNode.position.x + width / 2;
        const targetNodeCenterY = targetNode.position.y + height / 2;

        const currentViewport = reactFlow.getViewport();
        const startX = currentViewport.x;
        const startY = currentViewport.y;
        const startZoom = currentViewport.zoom;

        const flowEl = document.querySelector('.react-flow') as HTMLElement | null;
        const containerWidth = flowEl?.clientWidth || window.innerWidth || 1200;
        const containerHeight = flowEl?.clientHeight || window.innerHeight || 800;

        // Position node towards left-center so the right-side search dialog has breathing room
        const screenAnchorX = containerWidth / 2 - 170;
        const screenAnchorY = containerHeight / 2;

        // Find the current canvas position currently resting under screenAnchor
        const currentCanvasX = (screenAnchorX - startX) / startZoom;
        const currentCanvasY = (screenAnchorY - startY) / startZoom;

        const dx = targetNodeCenterX - currentCanvasX;
        const dy = targetNodeCenterY - currentCanvasY;
        const dist = Math.hypot(dx, dy);

        // Desired target zoom: comfortable reading overview zoom (~0.76 - 0.82)
        // If user is currently zoomed in, smoothly pull back to 0.78
        // If user is already zoomed out (< 0.7), bring up to 0.72
        let targetZoom = 0.78;
        if (startZoom < 0.7) {
          targetZoom = Math.max(0.68, startZoom);
        } else if (startZoom <= 0.85) {
          targetZoom = startZoom;
        } else {
          targetZoom = 0.80;
        }

        // Swoop zoom-out effect:
        // During camera flight, zoom dips down (pulls back out) along a sine arc
        // so the user sees a panoramic overview of the graph during travel,
        // then smoothly glides in to land on the commit.
        const dipFactor = Math.min(0.28, Math.max(0.12, (dist / 1000) * 0.20 + 0.10));
        const dipAmount = Math.min(startZoom, targetZoom) * dipFactor;

        // Dynamic flight duration based on travel distance (580ms to 880ms)
        const duration = Math.min(880, Math.max(580, 520 + Math.sqrt(dist) * 9.5));
        const startTime = performance.now();

        // Quintic ease in-out for zero initial and final jerk (ultra-smooth)
        const ease = (t: number) =>
          t < 0.5 ? 16 * Math.pow(t, 5) : 1 - Math.pow(-2 * t + 2, 5) / 2;

        const step = (now: number) => {
          const rawProgress = (now - startTime) / duration;
          const progress = Math.min(1, Math.max(0, rawProgress));
          const eased = ease(progress);

          // Interpolate canvas focus point
          const curCanvasX = currentCanvasX + (targetNodeCenterX - currentCanvasX) * eased;
          const curCanvasY = currentCanvasY + (targetNodeCenterY - currentCanvasY) * eased;

          // Interpolate base zoom from startZoom to targetZoom
          const baseZoom = startZoom + (targetZoom - startZoom) * eased;

          // Parabolic / sinusoidal zoom-out dip at midpoint
          const dip = Math.sin(Math.PI * eased) * dipAmount;
          const curZoom = Math.max(0.25, baseZoom - dip);

          // Calculate viewport x & y so curCanvasX/curCanvasY sits at screenAnchorX/screenAnchorY
          const curViewportX = screenAnchorX - curCanvasX * curZoom;
          const curViewportY = screenAnchorY - curCanvasY * curZoom;

          reactFlow.setViewport({
            x: curViewportX,
            y: curViewportY,
            zoom: curZoom,
          });

          if (progress < 1) {
            flyAnimationRef.current = requestAnimationFrame(step);
          } else {
            // Final exact frame
            reactFlow.setViewport({
              x: screenAnchorX - targetNodeCenterX * targetZoom,
              y: screenAnchorY - targetNodeCenterY * targetZoom,
              zoom: targetZoom,
            });
            flyAnimationRef.current = null;
          }
        };

        flyAnimationRef.current = requestAnimationFrame(step);
      }
    },
    [reactFlow, selectNode, nodes]
  );

  const renderCommitItem = useCallback(
    (c: SearchMatch) => {
      const isSelected =
        selectedNodeId === c.hash ||
        selectedNodeId === c.shortHash ||
        selectedNodeId === c.nodeId;
      return (
        <div
          key={c.hash}
          className={`commit-search-item ${c.isHead ? 'is-head' : ''} ${isSelected ? 'selected' : ''}`}
          onClick={() => handleSelectSearchCommit(c.hash, c.shortHash)}
          title={
            c.isHead
              ? `Current checked-out commit (HEAD: ${c.shortHash}). Click to view in graph`
              : `Click to view commit ${c.shortHash} in graph`
          }
        >
          <div className="commit-search-item-top">
            <div className="commit-search-item-left">
              <span
                className="commit-search-dot"
                style={{
                  backgroundColor: c.color,
                  boxShadow: `0 0 6px ${c.color}88`,
                }}
              />
              <span className="commit-search-hash">{c.shortHash}</span>
              {c.isHead && (
                <span className="commit-search-badge head" title="Current checked-out commit (HEAD)">
                  ● HEAD
                </span>
              )}
              {c.tags.map((t) => {
                const isHighlighted =
                  commitSearchQuery.trim() &&
                  t.toLowerCase().includes(commitSearchQuery.trim().toLowerCase());
                return (
                  <span
                    key={t}
                    className={`commit-search-badge tag ${isHighlighted ? 'highlight' : ''}`}
                    title={`Tag: ${t}`}
                  >
                    🏷 {t}
                  </span>
                );
              })}
              {c.branches.slice(0, 2).map((b) => (
                <span key={b} className="commit-search-badge branch" title={`Branch: ${b}`}>
                  ⎇ {b}
                </span>
              ))}
              {c.branches.length > 2 && (
                <span
                  className="commit-search-badge branch-more"
                  title={c.branches.slice(2).join(', ')}
                >
                  +{c.branches.length - 2}
                </span>
              )}
            </div>
            <span className="commit-search-date" title={getCommitFullDate(c.timestamp)}>
              {getCommitTimeAgo(c.timestamp)}
            </span>
          </div>
          <div className="commit-search-item-bottom">
            <span className="commit-search-msg" title={c.message}>
              {c.message}
            </span>
            {c.author && <span className="commit-search-author">{c.author}</span>}
          </div>
        </div>
      );
    },
    [selectedNodeId, handleSelectSearchCommit, commitSearchQuery]
  );

  const primaryRemote = remotes.find(r => r.name === 'origin') ?? remotes[0];
  const hasStashes = nodes.some(n => n.type === 'stash' || (n.data as any)?.kind === 'stash');
  const isRebasing = repositoryState === 'rebasing';
  const isMerging = repositoryState === 'merging';

  // Close rebase dropdown on outside click
  useEffect(() => {
    if (!isRebaseDropdownOpen) return;
    const handleOutside = (e: MouseEvent | PointerEvent) => {
      const target = e.target as Node | null;
      if (target && rebaseDropdownRef.current && !rebaseDropdownRef.current.contains(target)) {
        setIsRebaseDropdownOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutside, true);
    document.addEventListener('mousedown', handleOutside, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutside, true);
      document.removeEventListener('mousedown', handleOutside, true);
    };
  }, [isRebaseDropdownOpen]);

  // Close merge dropdown on outside click
  useEffect(() => {
    if (!isMergeDropdownOpen) return;
    const handleOutside = (e: MouseEvent | PointerEvent) => {
      const target = e.target as Node | null;
      if (target && mergeDropdownRef.current && !mergeDropdownRef.current.contains(target)) {
        setIsMergeDropdownOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutside, true);
    document.addEventListener('mousedown', handleOutside, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutside, true);
      document.removeEventListener('mousedown', handleOutside, true);
    };
  }, [isMergeDropdownOpen]);

  return (
    <>
      {/* Top-right toolbar */}
      <div className="graph-toolbar">
        {/* Rebase In Progress Button */}
        {isRebasing && (
          <div style={{ position: 'relative' }} ref={rebaseDropdownRef}>
            <button
              className={`toolbar-button rebase-progress-btn ${isRebaseDropdownOpen ? 'active' : ''}`}
              onClick={() => setIsRebaseDropdownOpen(prev => !prev)}
              title="Rebase is in progress. Click for options."
            >
              <span className="rebase-progress-dot" />
              Rebase in progress
              <span className="rebase-progress-chevron">{isRebaseDropdownOpen ? '\u25B4' : '\u25BE'}</span>
            </button>

            <AnimatePresence>
              {isRebaseDropdownOpen && (
                <motion.div
                  className="rebase-toolbar-dropdown"
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 4 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.15 }}
                >
                  <div
                    className="rebase-toolbar-dropdown-item"
                    onClick={() => {
                      setIsRebaseDropdownOpen(false);
                      postMessage({ type: 'rebase-continue' });
                    }}
                  >
                    <span className="rebase-toolbar-dropdown-icon">&#x25BA;</span>
                    <div>
                      <div className="rebase-toolbar-dropdown-title">Continue Rebase</div>
                      <div className="rebase-toolbar-dropdown-desc">Continue to the next step</div>
                    </div>
                  </div>
                  <div
                    className="rebase-toolbar-dropdown-item"
                    onClick={() => {
                      setIsRebaseDropdownOpen(false);
                      postMessage({ type: 'rebase-skip' });
                    }}
                  >
                    <span className="rebase-toolbar-dropdown-icon">&#xBB;</span>
                    <div>
                      <div className="rebase-toolbar-dropdown-title">Skip This Commit</div>
                      <div className="rebase-toolbar-dropdown-desc">Skip the current commit and move on</div>
                    </div>
                  </div>
                  <div
                    className="rebase-toolbar-dropdown-item danger"
                    onClick={() => {
                      setIsRebaseDropdownOpen(false);
                      postMessage({ type: 'rebase-abort' });
                    }}
                  >
                    <span className="rebase-toolbar-dropdown-icon">&#x2715;</span>
                    <div>
                      <div className="rebase-toolbar-dropdown-title">Abort Rebase</div>
                      <div className="rebase-toolbar-dropdown-desc">Cancel and restore original state</div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Merge In Progress Button */}
        {isMerging && (
          <div style={{ position: 'relative' }} ref={mergeDropdownRef}>
            <button
              className={`toolbar-button merge-progress-btn ${isMergeDropdownOpen ? 'active' : ''}`}
              onClick={() => setIsMergeDropdownOpen(prev => !prev)}
              title="Merge is in progress. Click for options."
            >
              <span className="merge-progress-dot" />
              Merge in progress
              <span className="merge-progress-chevron">{isMergeDropdownOpen ? '\u25B4' : '\u25BE'}</span>
            </button>

            <AnimatePresence>
              {isMergeDropdownOpen && (
                <motion.div
                  className="rebase-toolbar-dropdown"
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 4 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.15 }}
                >
                  <div
                    className="rebase-toolbar-dropdown-item"
                    onClick={() => {
                      setIsMergeDropdownOpen(false);
                      postMessage({ type: 'resolve-conflicts' });
                    }}
                  >
                    <span className="rebase-toolbar-dropdown-icon">&#x2699;</span>
                    <div>
                      <div className="rebase-toolbar-dropdown-title">Resolve Conflicts</div>
                      <div className="rebase-toolbar-dropdown-desc">Open conflicted files in the editor</div>
                    </div>
                  </div>
                  <div
                    className="rebase-toolbar-dropdown-item"
                    onClick={() => {
                      setIsMergeDropdownOpen(false);
                      postMessage({ type: 'merge-continue' });
                    }}
                  >
                    <span className="rebase-toolbar-dropdown-icon">&#x25BA;</span>
                    <div>
                      <div className="rebase-toolbar-dropdown-title">Complete Merge</div>
                      <div className="rebase-toolbar-dropdown-desc">Commit the resolved merge</div>
                    </div>
                  </div>
                  <div
                    className="rebase-toolbar-dropdown-item danger"
                    onClick={() => {
                      setIsMergeDropdownOpen(false);
                      postMessage({ type: 'merge-abort' });
                    }}
                  >
                    <span className="rebase-toolbar-dropdown-icon">&#x2715;</span>
                    <div>
                      <div className="rebase-toolbar-dropdown-title">Abort Merge</div>
                      <div className="rebase-toolbar-dropdown-desc">Cancel and restore pre-merge state</div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

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

        {/* Find Commits & Tags Search */}
        <div ref={commitSearchPopupRef}>
          <button
            className={`toolbar-button ${isCommitSearchOpen ? 'active' : ''}`}
            onClick={handleToggleCommitSearch}
            title="Find Commits or Tags (Ctrl+F)"
            style={{ fontSize: '14px' }}
          >
            <SearchCommitsIcon style={{ width: '1.2em', height: '1.2em' }} />
          </button>

          <AnimatePresence>
            {isCommitSearchOpen && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                style={{ transformOrigin: 'top right' }}
                className="commit-search-popup"
              >
                <div className="commit-search-header">
                  <span className="commit-search-title">
                    <SearchCommitsIcon style={{ width: '1.1em', height: '1.1em', marginRight: '6px' }} />
                    Find Commits &amp; Tags
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="commit-search-count">
                      {commitSearchQuery.trim()
                        ? `${commitSearchResults.length} ${commitSearchResults.length === 1 ? 'match' : 'matches'}`
                        : `${(headCommitNode ? 1 : 0) + recentCommits.length} commits`}
                    </span>
                    <button
                      className="commit-search-close-btn"
                      onClick={() => setIsCommitSearchOpen(false)}
                      title="Close (Esc)"
                    >
                      &#x2715;
                    </button>
                  </div>
                </div>

                <div className="commit-search-input-row">
                  <input
                    ref={commitSearchInputRef}
                    className="commit-search-input"
                    type="text"
                    placeholder="Search by message, hash, or tag (e.g. fix, v1.0, 73aadf1)"
                    value={commitSearchQuery}
                    onChange={(e) => setCommitSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (commitSearchQuery.trim()) {
                          if (commitSearchResults.length > 0) {
                            handleSelectSearchCommit(
                              commitSearchResults[0].hash,
                              commitSearchResults[0].shortHash
                            );
                          }
                        } else if (headCommitNode) {
                          handleSelectSearchCommit(
                            headCommitNode.hash,
                            headCommitNode.shortHash
                          );
                        } else if (recentCommits.length > 0) {
                          handleSelectSearchCommit(
                            recentCommits[0].hash,
                            recentCommits[0].shortHash
                          );
                        }
                      }
                      if (e.key === 'Escape') {
                        setIsCommitSearchOpen(false);
                      }
                      e.stopPropagation();
                    }}
                  />
                  <button
                    className="commit-search-clear-btn"
                    onClick={handleClearCommitSearch}
                    disabled={!commitSearchQuery}
                    title="Clear search"
                  >
                    &#x2715;
                  </button>
                </div>

                <div className="commit-search-results">
                  {commitSearchQuery.trim() ? (
                    commitSearchResults.length === 0 ? (
                      <div className="commit-search-empty">
                        No commits or tags found matching &ldquo;<strong>{commitSearchQuery}</strong>&rdquo;
                      </div>
                    ) : (
                      <div className="commit-search-list">
                        {commitSearchResults.map(renderCommitItem)}
                      </div>
                    )
                  ) : (
                    <>
                      {headCommitNode && (
                        <div className="commit-search-section">
                          <div className="commit-search-subheader head-subheader">
                            <span>Checked-Out Commit</span>
                          </div>
                          <div className="commit-search-list">
                            {renderCommitItem(headCommitNode)}
                          </div>
                        </div>
                      )}
                      <div className="commit-search-section">
                        <div className="commit-search-subheader">
                          <span>Recent Commits</span>
                        </div>
                        <div className="commit-search-list">
                          {recentCommits.length === 0 ? (
                            <div className="commit-search-empty">No recent commits</div>
                          ) : (
                            recentCommits.map(renderCommitItem)
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* File History Search */}
        <div ref={searchPopupRef}>
          <button
            className={`toolbar-button ${isSearchOpen ? 'active' : ''}`}
            onClick={handleToggleSearch}
            title="Search File/Folder in History"
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
                style={{ transformOrigin: 'top right' }}
                className="file-search-popup"
              >
                <div className="file-search-header">
                  <span className="file-search-title">
                    <img src={SearchIcon} style={{ width: '1.5em', height: '1.5em', verticalAlign: 'middle', marginRight: '6px' }} alt="Search" />
                    Search File/Folder in History
                  </span>
                  <button
                    className="file-search-close-btn"
                    onClick={() => setIsSearchOpen(false)}
                    title="Close (Esc)"
                  >
                    &#x2715;
                  </button>
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
                    title={isSearching ? 'Searching...' : !searchQuery.trim() ? 'Enter a file/folder path to search' : 'Search for file/folder in history'}
                  >
                    {isSearching ? '...' : 'Search'}
                  </button>
                  <button
                    className="file-search-clear-btn"
                    onClick={handleClearSearch}
                    disabled={!searchQuery && !searchResults}
                    title="Clear input"
                  >
                    &#x2715;
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
                            title={isPurging !== null ? 'Purge in progress...' : isConfirmingPurge !== null ? 'Waiting for confirmation...' : 'Permanently remove this file/folder from all history'}
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
                          {searchResults.commits.map((c) => {
                            const isSelected = selectedNodeId === c.hash || selectedNodeId === c.shortHash;
                            return (
                              <div
                                key={c.hash}
                                className={`file-search-commit ${isSelected ? 'selected' : ''}`}
                                onClick={() => handleSelectSearchCommit(c.hash, c.shortHash)}
                                title={`Click to view commit ${c.shortHash} in graph`}
                              >
                                <span className="file-search-commit-hash">{c.shortHash}</span>
                                <span className="file-search-commit-msg" title={c.message}>{c.message}</span>
                                <span className="file-search-commit-author">{c.author}</span>
                                <span className="file-search-commit-date">
                                  {new Date(c.date).toLocaleDateString()}
                                </span>
                              </div>
                            );
                          })}
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
          onClick={handlePull}
          title="Pull from Remote"
        >
          ↓
        </button>
        <button
          className="toolbar-button"
          onClick={handleRefresh}
          title="Fetch from remote"
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
                  <code>git fetch --all --prune</code>
                </div>
                <div className="file-search-command-line">
                  <span className="file-search-command-prompt">$</span>
                  <code>git stash push -u -m "auto-stash before purge"</code>
                </div>
                <div className="file-search-command-line">
                  <span className="file-search-command-prompt">$</span>
                  <code>git filter-branch --force --index-filter "git rm -r --cached --ignore-unmatch '{isPurging}'" --prune-empty --tag-name-filter cat -- --all</code>
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
                  <code>git push --force &lt;remote&gt; &lt;rewritten-ref&gt;:refs/heads/&lt;branch&gt;  # for every branch</code>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <PullModal
        isOpen={isPullModalOpen}
        onClose={() => setIsPullModalOpen(false)}
        onPull={handleExecutePull}
      />
    </>
  );
}

export const Toolbar = React.memo(ToolbarComponent);
