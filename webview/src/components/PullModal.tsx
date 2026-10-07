/**
 * PullModal — Modal dialog for pulling from remote repository.
 *
 * Allows users to:
 * - Select a specific remote branch to pull into the current branch
 * - Or select the "Pull from all branches" option to fetch and sync all tracking branches
 * - Choose the remote (e.g. origin, upstream)
 * - Toggle --rebase and --autostash options
 * - View a live Git command preview before executing
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGraphStore } from '../store/graph.store';

export interface PullOptions {
  remote: string;
  branch?: string;
  pullAll: boolean;
  rebase: boolean;
  autostash: boolean;
}

interface PullModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPull: (options: PullOptions) => void;
}

export function PullModal({ isOpen, onClose, onPull }: PullModalProps) {
  const { currentBranch, remotes, graphNodes } = useGraphStore();

  // Mode: 'branch' (single branch) vs 'all' (all branches)
  const [mode, setMode] = useState<'branch' | 'all'>('branch');
  const [selectedRemote, setSelectedRemote] = useState<string>('origin');
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [rebase, setRebase] = useState<boolean>(false);
  const [autostash, setAutostash] = useState<boolean>(false);

  // Available remote names
  const remoteNames = useMemo(() => {
    if (remotes && remotes.length > 0) {
      return remotes.map((r) => r.name);
    }
    return ['origin'];
  }, [remotes]);

  // Set default remote on open
  useEffect(() => {
    if (isOpen) {
      if (remoteNames.includes('origin')) {
        setSelectedRemote('origin');
      } else if (remoteNames.length > 0) {
        setSelectedRemote(remoteNames[0]!);
      }
    }
  }, [isOpen, remoteNames]);

  // Available branches for the selected remote
  const availableBranches = useMemo(() => {
    const branchesMap = new Map<string, { name: string; hasRemote: boolean; isCurrent: boolean }>();

    for (const [, node] of graphNodes) {
      if (node.kind === 'remote-branch') {
        const fullLabel = node.label;
        const prefix = `${selectedRemote}/`;
        if (fullLabel.startsWith(prefix)) {
          const shortName = fullLabel.slice(prefix.length);
          if (shortName && !shortName.includes('HEAD')) {
            branchesMap.set(shortName, {
              name: shortName,
              hasRemote: true,
              isCurrent: shortName === currentBranch,
            });
          }
        }
      } else if (node.kind === 'branch') {
        const bName = node.label;
        if (!branchesMap.has(bName)) {
          branchesMap.set(bName, {
            name: bName,
            hasRemote: false,
            isCurrent: bName === currentBranch,
          });
        }
      }
    }

    // Ensure currentBranch is in the list
    if (currentBranch && !branchesMap.has(currentBranch)) {
      branchesMap.set(currentBranch, {
        name: currentBranch,
        hasRemote: false,
        isCurrent: true,
      });
    }

    const list = Array.from(branchesMap.values());

    // Sort: current branch first, then main/master/develop, then alphabetical
    return list.sort((a, b) => {
      if (a.isCurrent) return -1;
      if (b.isCurrent) return 1;
      const primaryNames = ['main', 'master', 'dev', 'develop'];
      const aIsPrimary = primaryNames.includes(a.name);
      const bIsPrimary = primaryNames.includes(b.name);
      if (aIsPrimary && !bIsPrimary) return -1;
      if (!aIsPrimary && bIsPrimary) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [graphNodes, selectedRemote, currentBranch]);

  // Default selected branch
  useEffect(() => {
    if (isOpen) {
      if (currentBranch && availableBranches.some((b) => b.name === currentBranch)) {
        setSelectedBranch(currentBranch);
      } else if (availableBranches.length > 0) {
        setSelectedBranch(availableBranches[0]!.name);
      } else {
        setSelectedBranch('main');
      }
    }
  }, [isOpen, currentBranch, availableBranches]);

  // Handle submit
  const handleExecute = useCallback(() => {
    onPull({
      remote: selectedRemote,
      branch: mode === 'all' ? undefined : selectedBranch,
      pullAll: mode === 'all',
      rebase,
      autostash,
    });
    onClose();
  }, [onPull, onClose, selectedRemote, selectedBranch, mode, rebase, autostash]);

  // Keyboard navigation (Escape to close, Enter to submit)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        // Prevent accidental submit if focused on select element
        const target = e.target as HTMLElement;
        if (target && target.tagName === 'SELECT') return;
        e.preventDefault();
        handleExecute();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, handleExecute]);

  // Generated command preview
  const commandPreview = useMemo(() => {
    if (mode === 'all') {
      let cmd = 'git fetch --all --prune && git pull --all';
      if (rebase) cmd += ' --rebase';
      if (autostash) cmd += ' --autostash';
      return cmd;
    }
    let cmd = `git pull ${selectedRemote} ${selectedBranch || '<branch>'}`;
    if (rebase) cmd += ' --rebase';
    if (autostash) cmd += ' --autostash';
    return cmd;
  }, [mode, selectedRemote, selectedBranch, rebase, autostash]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="pull-modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="pull-modal-container"
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="pull-modal-header">
            <div className="pull-modal-title-group">
              <div className="pull-modal-icon">↓</div>
              <div>
                <div className="pull-modal-title">Pull from Remote</div>
                <div className="pull-modal-subtitle">
                  Fetch and integrate changes from a remote repository into your branch
                </div>
              </div>
            </div>
            <button
              className="pull-modal-close-btn"
              onClick={onClose}
              title="Close (Esc)"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div className="pull-modal-body">
            {/* Context Banner */}
            <div className="pull-modal-context-banner">
              <div className="pull-modal-context-item">
                <span>Active Branch:</span>
                <span className="pull-modal-badge">
                  <span>⎇</span>
                  <span>{currentBranch ?? 'HEAD (detached)'}</span>
                </span>
              </div>
              <div className="pull-modal-context-item">
                <span>Remote:</span>
                <span className="pull-modal-badge">
                  <span>☁</span>
                  <span>{selectedRemote}</span>
                </span>
              </div>
            </div>

            {/* Mode Selector */}
            <div className="pull-modal-mode-grid">
              <button
                type="button"
                className={`pull-modal-mode-card ${mode === 'branch' ? 'active' : ''}`}
                onClick={() => setMode('branch')}
              >
                <div className="pull-modal-mode-title">
                  <span>⎇</span>
                  <span>Specific Branch</span>
                </div>
                <div className="pull-modal-mode-desc">
                  Pull changes from a selected branch into {currentBranch ?? 'HEAD'}
                </div>
              </button>

              <button
                type="button"
                className={`pull-modal-mode-card ${mode === 'all' ? 'active' : ''}`}
                onClick={() => setMode('all')}
              >
                <div className="pull-modal-mode-title">
                  <span>⟳</span>
                  <span>All Branches</span>
                </div>
                <div className="pull-modal-mode-desc">
                  Fetch all remote branches and fast-forward tracking branches
                </div>
              </button>
            </div>

            {/* Branch Selection Fields (when mode === 'branch') */}
            {mode === 'branch' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {remoteNames.length > 1 && (
                  <div className="pull-modal-field">
                    <label className="pull-modal-label">Remote Repository</label>
                    <select
                      className="pull-modal-select"
                      value={selectedRemote}
                      onChange={(e) => setSelectedRemote(e.target.value)}
                    >
                      {remoteNames.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="pull-modal-field">
                  <label className="pull-modal-label">
                    <span>Branch to Pull From</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      into {currentBranch ?? 'HEAD'}
                    </span>
                  </label>
                  <select
                    className="pull-modal-select"
                    value={selectedBranch}
                    onChange={(e) => setSelectedBranch(e.target.value)}
                  >
                    {availableBranches.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name}
                        {b.isCurrent ? ' (current)' : ''}
                        {b.hasRemote ? ` [on ${selectedRemote}]` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              /* All Branches Info Box */
              <div className="pull-modal-info-box">
                <span style={{ fontSize: '16px' }}>ℹ</span>
                <span>
                  All configured remote branches will be fetched and updated. Local branches tracking remote branches will be synchronized.
                </span>
              </div>
            )}

            {/* Pull Options */}
            <div className="pull-modal-options-group">
              <label className="pull-modal-checkbox-row">
                <input
                  type="checkbox"
                  checked={rebase}
                  onChange={(e) => setRebase(e.target.checked)}
                />
                <div className="pull-modal-checkbox-content">
                  <span className="pull-modal-checkbox-title">
                    Rebase instead of merge (--rebase)
                  </span>
                  <span className="pull-modal-checkbox-desc">
                    Reapplies your local commits on top of pulled changes rather than creating a merge commit.
                  </span>
                </div>
              </label>

              <label className="pull-modal-checkbox-row">
                <input
                  type="checkbox"
                  checked={autostash}
                  onChange={(e) => setAutostash(e.target.checked)}
                />
                <div className="pull-modal-checkbox-content">
                  <span className="pull-modal-checkbox-title">
                    Autostash uncommitted changes (--autostash)
                  </span>
                  <span className="pull-modal-checkbox-desc">
                    Automatically stashes modified files before pulling and reapplies them afterwards.
                  </span>
                </div>
              </label>
            </div>

            {/* Command Preview */}
            <div className="pull-modal-command-box">
              <span className="pull-modal-command-label">Git Command Preview</span>
              <div className="pull-modal-command-code">
                <span className="pull-modal-command-prompt">$</span>
                <span>{commandPreview}</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="pull-modal-footer">
            <button
              type="button"
              className="pull-modal-btn pull-modal-btn-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="pull-modal-btn pull-modal-btn-pull"
              disabled={mode === 'branch' && !selectedBranch}
              onClick={handleExecute}
            >
              <span>↓</span>
              <span>{mode === 'all' ? 'Pull All Branches' : `Pull from ${selectedBranch || 'Remote'}`}</span>
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
