/**
 * InteractiveRebaseModal — Visual interactive rebase interface for Git Atlas.
 *
 * Allows users to:
 * - Reorder commits with move up/down controls
 * - Set actions per commit: pick, reword, edit, squash, fixup, drop
 * - Edit commit messages inline when reword is selected
 * - Toggle --autostash and --rebase-merges options
 * - Preview the generated git-rebase-todo sequence in real time
 * - Execute or cancel the interactive rebase
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import type { RebaseCommitItem, RebaseAction } from '../types';

interface InteractiveRebaseModalProps {
  baseRef: string;
  targetLabel?: string;
  currentBranch: string | null;
  commits: RebaseCommitItem[];
  isLoading: boolean;
  error?: string;
  onExecute: (items: RebaseCommitItem[], options: { autostash: boolean; rebaseMerges: boolean }) => void;
  onCancel: () => void;
}

const ACTION_OPTIONS: { value: RebaseAction; label: string; description: string }[] = [
  { value: 'pick', label: 'pick', description: 'Use commit as-is' },
  { value: 'reword', label: 'reword', description: 'Use commit, but edit message' },
  { value: 'edit', label: 'edit', description: 'Stop to amend commit' },
  { value: 'squash', label: 'squash', description: 'Meld into previous commit' },
  { value: 'fixup', label: 'fixup', description: 'Meld into previous, discard log' },
  { value: 'drop', label: 'drop', description: 'Remove commit entirely' },
];

function getTimeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 2592000)}mo ago`;
}

function InteractiveRebaseModalComponent({
  baseRef,
  targetLabel,
  currentBranch,
  commits,
  isLoading,
  error,
  onExecute,
  onCancel,
}: InteractiveRebaseModalProps) {
  const [items, setItems] = useState<RebaseCommitItem[]>([]);
  const [autostash, setAutostash] = useState(true);
  const [rebaseMerges, setRebaseMerges] = useState(false);
  const [showTodoPreview, setShowTodoPreview] = useState(false);

  // Initialize or reset items when incoming commits change
  useEffect(() => {
    setItems(commits.map((c) => ({ ...c, action: c.action || 'pick' })));
  }, [commits]);

  const shortBase = baseRef.length > 12 ? baseRef.substring(0, 7) : baseRef;
  const displayTarget = targetLabel || shortBase;

  // Move a commit up in the sequence
  const handleMoveUp = useCallback((index: number) => {
    if (index <= 0) return;
    setItems((prev) => {
      const next = [...prev];
      const temp = next[index]!;
      next[index] = next[index - 1]!;
      next[index - 1] = temp;

      // Ensure the new first commit is not squash or fixup
      if (index - 1 === 0 && (next[0]!.action === 'squash' || next[0]!.action === 'fixup')) {
        next[0] = { ...next[0]!, action: 'pick' };
      }
      return next;
    });
  }, []);

  // Move a commit down in the sequence
  const handleMoveDown = useCallback((index: number) => {
    setItems((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      const temp = next[index]!;
      next[index] = next[index + 1]!;
      next[index + 1] = temp;

      // Ensure the new first commit is not squash or fixup
      if (next[0]!.action === 'squash' || next[0]!.action === 'fixup') {
        next[0] = { ...next[0]!, action: 'pick' };
      }
      return next;
    });
  }, []);

  // Change action for a commit
  const handleActionChange = useCallback((index: number, action: RebaseAction) => {
    setItems((prev) => {
      const next = [...prev];
      const current = next[index]!;
      // First commit cannot be squash or fixup
      const safeAction = (index === 0 && (action === 'squash' || action === 'fixup')) ? 'pick' : action;
      next[index] = {
        ...current,
        action: safeAction,
        newMessage: safeAction === 'reword' ? (current.newMessage ?? current.subject) : current.newMessage,
      };
      return next;
    });
  }, []);

  // Toggle drop for a commit
  const handleToggleDrop = useCallback((index: number) => {
    setItems((prev) => {
      const next = [...prev];
      const current = next[index]!;
      const isDropping = current.action !== 'drop';
      const newAction: RebaseAction = isDropping ? 'drop' : 'pick';
      next[index] = { ...current, action: newAction };
      return next;
    });
  }, []);

  // Update reworded message
  const handleMessageChange = useCallback((index: number, msg: string) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index]!, newMessage: msg };
      return next;
    });
  }, []);

  // Reset to original commits
  const handleReset = useCallback(() => {
    setItems(commits.map((c) => ({ ...c, action: 'pick', newMessage: undefined })));
  }, [commits]);

  // Validation
  const isValid = useMemo(() => {
    if (items.length === 0) return false;
    if (items[0]!.action === 'squash' || items[0]!.action === 'fixup') return false;
    return true;
  }, [items]);

  // Generated todo preview text
  const todoPreviewText = useMemo(() => {
    return items
      .map((item, idx) => {
        if (item.action === 'drop') {
          return `drop ${item.shortHash} ${item.subject}`;
        }
        if (item.action === 'reword' && item.newMessage && item.newMessage.trim() !== item.subject.trim()) {
          return `pick ${item.shortHash} ${item.subject}\nexec git commit --amend -m "${item.newMessage.trim().replace(/"/g, '\\"')}"`;
        }
        const act = idx === 0 && (item.action === 'squash' || item.action === 'fixup') ? 'pick' : item.action;
        return `${act} ${item.shortHash} ${item.subject}`;
      })
      .join('\n');
  }, [items]);

  const handleStartRebase = () => {
    if (!isValid) return;
    onExecute(items, { autostash, rebaseMerges });
  };

  return (
    <motion.div
      className="interactive-rebase-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onCancel}
    >
      <motion.div
        className="interactive-rebase-modal"
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="interactive-rebase-header">
          <div className="interactive-rebase-title-group">
            <span className="interactive-rebase-icon">⤴</span>
            <span className="interactive-rebase-title">Interactive Rebase</span>
            <span className="interactive-rebase-badge">
              onto {displayTarget}
            </span>
            {currentBranch && (
              <span className="interactive-rebase-badge" style={{ background: 'rgba(63, 185, 80, 0.15)', color: '#3fb950' }}>
                {currentBranch}
              </span>
            )}
          </div>
          <button
            className="interactive-rebase-close-btn"
            onClick={onCancel}
            title="Cancel (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="interactive-rebase-body">
          <div className="interactive-rebase-instructions">
            Reorder commits or change actions to rewrite the history of <strong>{currentBranch ?? 'HEAD'}</strong>.
            Commits are executed from top to bottom.
          </div>

          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-secondary)' }}>
              <span>Loading commits for rebase...</span>
            </div>
          ) : error ? (
            <div style={{ color: '#f85149', padding: '16px', background: 'rgba(248, 81, 73, 0.1)', borderRadius: '6px' }}>
              Failed to load commits: {error}
            </div>
          ) : items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-secondary)' }}>
              No commits to rebase between {displayTarget} and {currentBranch ?? 'HEAD'}.
            </div>
          ) : (
            <div className="interactive-rebase-list">
              {items.map((item, index) => {
                const isFirst = index === 0;
                const isLast = index === items.length - 1;
                const isMeld = item.action === 'squash' || item.action === 'fixup';

                return (
                  <div
                    key={item.hash}
                    className={`interactive-rebase-row ${item.action}`}
                  >
                    {/* Move controls */}
                    <div className="interactive-rebase-order-controls">
                      <button
                        className="interactive-rebase-order-btn"
                        disabled={isFirst}
                        onClick={() => handleMoveUp(index)}
                        title="Move commit earlier in sequence"
                      >
                        ▲
                      </button>
                      <button
                        className="interactive-rebase-order-btn"
                        disabled={isLast}
                        onClick={() => handleMoveDown(index)}
                        title="Move commit later in sequence"
                      >
                        ▼
                      </button>
                    </div>

                    {/* Action Selector */}
                    <select
                      className={`interactive-rebase-action-select ${item.action}`}
                      value={item.action}
                      onChange={(e) => handleActionChange(index, e.target.value as RebaseAction)}
                    >
                      {ACTION_OPTIONS.map((opt) => (
                        <option
                          key={opt.value}
                          value={opt.value}
                          disabled={isFirst && (opt.value === 'squash' || opt.value === 'fixup')}
                        >
                          {opt.label} — {opt.description}
                        </option>
                      ))}
                    </select>

                    {/* Commit hash */}
                    <span className="interactive-rebase-commit-hash">
                      {item.shortHash}
                    </span>

                    {/* Commit details & inline editor */}
                    <div className="interactive-rebase-commit-content">
                      {isMeld && (
                        <span className="interactive-rebase-meld-indicator">↳</span>
                      )}

                      {item.action === 'reword' ? (
                        <input
                          type="text"
                          className="interactive-rebase-reword-input"
                          value={item.newMessage ?? item.subject}
                          onChange={(e) => handleMessageChange(index, e.target.value)}
                          placeholder="Enter new commit message..."
                        />
                      ) : (
                        <span className="interactive-rebase-commit-subject" title={item.subject}>
                          {item.subject}
                        </span>
                      )}

                      <div className="interactive-rebase-commit-meta">
                        <span>{item.author}</span>
                        <span>•</span>
                        <span>{getTimeAgo(item.timestamp)}</span>
                      </div>
                    </div>

                    {/* Quick drop toggle */}
                    <button
                      className="interactive-rebase-drop-btn"
                      onClick={() => handleToggleDrop(index)}
                      title={item.action === 'drop' ? 'Restore commit' : 'Drop commit'}
                    >
                      {item.action === 'drop' ? '↺' : '✕'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Rebase Options */}
          {items.length > 0 && (
            <div className="interactive-rebase-options">
              <label className="interactive-rebase-option-label">
                <input
                  type="checkbox"
                  checked={autostash}
                  onChange={(e) => setAutostash(e.target.checked)}
                />
                <span><strong>Autostash (--autostash)</strong>: Automatically stash uncommitted changes before rebase and restore them after</span>
              </label>

              <label className="interactive-rebase-option-label">
                <input
                  type="checkbox"
                  checked={rebaseMerges}
                  onChange={(e) => setRebaseMerges(e.target.checked)}
                />
                <span><strong>Preserve merges (--rebase-merges)</strong>: Recreate merge commits instead of flattening them</span>
              </label>
            </div>
          )}

          {/* Live Todo Preview */}
          {items.length > 0 && (
            <div>
              <button
                className="interactive-rebase-preview-toggle"
                onClick={() => setShowTodoPreview((p) => !p)}
              >
                <span>{showTodoPreview ? '▼' : '▶'}</span>
                <span>{showTodoPreview ? 'Hide' : 'Show'} git-rebase-todo preview ({items.length} commits)</span>
              </button>

              {showTodoPreview && (
                <div className="interactive-rebase-todo-preview">
                  {todoPreviewText}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="interactive-rebase-footer">
          <button
            className="interactive-rebase-btn interactive-rebase-btn-reset"
            onClick={handleReset}
            disabled={items.length === 0}
          >
            Reset Sequence
          </button>

          <div className="interactive-rebase-footer-right">
            <button
              className="interactive-rebase-btn interactive-rebase-btn-cancel"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="interactive-rebase-btn interactive-rebase-btn-start"
              disabled={!isValid || isLoading || items.length === 0}
              onClick={handleStartRebase}
              title={
                !isValid
                  ? 'First commit cannot be squash or fixup'
                  : `Start interactive rebase of ${items.length} commit${items.length !== 1 ? 's' : ''}`
              }
            >
              Start Interactive Rebase
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export const InteractiveRebaseModal = React.memo(InteractiveRebaseModalComponent);
