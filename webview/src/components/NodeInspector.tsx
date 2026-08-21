/**
 * NodeInspector — Slide-out panel showing full details for the selected node.
 *
 * Features:
 * - Glassmorphic slide-out from right edge
 * - Commit details: hash, author, date, message
 * - Diff stats with per-file insertion/deletion bars
 * - Action buttons grid with danger/disabled styling
 * - Framer Motion animations (slide in, staggered children)
 * - Close on Escape key
 */

import { useEffect, useCallback, useState, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useGraphStore } from '../store/graph.store';
import { postMessage } from '../vscode';
import { DiffStatBar } from './DiffStatBar';
import { ActionButton } from './ActionButton';
import { ActionPreviewPanel } from './ActionPreviewPanel';
import type { EdgeKind, ValidAction, GitHubPullRequest, CommitNodeData } from '../types';
import GlobeIcon from '../../../resources/icons/globe.svg';
import EditIcon from '../../../resources/icons/edit.svg';

export function NodeInspector() {
  const {
    isInspectorOpen,
    selectedNodeDetails,
    validActions,
    closeInspector,
    githubContext,
    headHash,
    currentBranch,
  } = useGraphStore();

  // Pending action for preview panel
  const [pendingAction, setPendingAction] = useState<ValidAction | null>(null);

  // Mergeability check state
  const [mergeability, setMergeability] = useState<{
    canMerge: boolean;
    status: 'clean' | 'conflicts' | 'up-to-date' | 'fast-forward' | 'error';
    conflictFiles: string[];
    aheadBehind: { ahead: number; behind: number };
    message: string;
  } | null>(null);
  const [isCheckingMerge, setIsCheckingMerge] = useState(false);

  // Commit message editing state
  const [isEditingMessage, setIsEditingMessage] = useState(false);
  const [editedMessage, setEditedMessage] = useState('');
  const [showEditConfirm, setShowEditConfirm] = useState(false);

  // Commit message & AI generation state for working directory
  const [commitInputMessage, setCommitInputMessage] = useState('');
  const [isGeneratingMessage, setIsGeneratingMessage] = useState(false);

  // Listen for generated commit message and mergeability results from extension host
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg?.type === 'commit-message-generated') {
        setCommitInputMessage(msg.message);
        setIsGeneratingMessage(false);
      } else if (msg?.type === 'mergeability-result') {
        setMergeability({
          canMerge: msg.canMerge,
          status: msg.status,
          conflictFiles: msg.conflictFiles,
          aheadBehind: msg.aheadBehind,
          message: msg.message,
        });
        setIsCheckingMerge(false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Clear pending action and editing state when node changes
  useEffect(() => {
    setPendingAction(null);
    setMergeability(null);
    setIsCheckingMerge(false);
    setIsEditingMessage(false);
    setEditedMessage('');
    setShowEditConfirm(false);
  }, [selectedNodeDetails?.nodeId]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pendingAction) {
          setPendingAction(null);
        } else if (isInspectorOpen) {
          closeInspector();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isInspectorOpen, closeInspector, pendingAction]);

  // Show preview panel instead of immediately executing
  const handleAction = useCallback(
    (kind: EdgeKind, args?: any) => {
      const action = validActions.find((a) => a.kind === kind);
      if (action) {
        setPendingAction({ ...action, args });
        // Trigger mergeability check for merge/rebase actions
        if ((kind === 'merge' || kind === 'rebase') && selectedNodeDetails) {
          setMergeability(null);
          setIsCheckingMerge(true);
          // Use the node label as the ref (branch name or remote branch name)
          const ref = selectedNodeDetails.label;
          postMessage({
            type: 'check-mergeability',
            nodeId: selectedNodeDetails.nodeId,
            ref,
          });
        }
      }
    },
    [validActions, selectedNodeDetails]
  );

  // Execute the pending action
  const handleProceed = useCallback((extraArgs?: Record<string, any>) => {
    if (pendingAction && selectedNodeDetails) {
      postMessage({
        type: 'action-requested',
        action: pendingAction.kind,
        nodeId: selectedNodeDetails.nodeId,
        args: { ...pendingAction.args, ...extraArgs },
      });
      setPendingAction(null);
      setMergeability(null);
    }
  }, [pendingAction, selectedNodeDetails]);

  const handleCancel = useCallback(() => {
    setPendingAction(null);
    setMergeability(null);
  }, []);

  const details = selectedNodeDetails;
  const maxChanges = details?.diffStats
    ? Math.max(...details.diffStats.map((s) => s.insertions + s.deletions), 1)
    : 1;

  return (
    <AnimatePresence>
      {isInspectorOpen && (
        <motion.div
          className="node-inspector glass"
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Header */}
          <div className="inspector-header">
            <div className="inspector-title">
              <span className="inspector-kind-icon">
                {getKindIcon(details?.kind)}
              </span>
              <span className="inspector-kind-label">
                {details?.kind?.replace('-', ' ') ?? 'Node'}
              </span>
            </div>
            <button
              className="inspector-close"
              onClick={closeInspector}
              title="Close (Esc)"
            >
              ✕
            </button>
          </div>

          {/* Content */}
          <div className="inspector-body">
            {!details ? (
              <div className="inspector-loading">
                <div className="inspector-loading-spinner" />
                <span>Loading details...</span>
              </div>
            ) : (
              <motion.div
                className="inspector-sections"
                initial="hidden"
                animate="visible"
                variants={{
                  visible: {
                    transition: { staggerChildren: 0.06 },
                  },
                }}
              >
                {/* Commit details section */}
                {details.hash && (
                  <motion.div
                    className="inspector-section"
                    variants={sectionVariants}
                  >
                    <div className="inspector-section-title">Commit</div>

                    <div className="inspector-field">
                      <span className="inspector-field-label">Hash</span>
                      <span className="inspector-field-value mono">
                        {details.hash}
                      </span>
                    </div>

                    {details.author && (
                      <div className="inspector-field">
                        <span className="inspector-field-label">Author</span>
                        <div className="inspector-author">
                          <div className="inspector-avatar">
                            {details.author.charAt(0).toUpperCase()}
                          </div>
                          <div className="inspector-author-info">
                            <span className="inspector-author-name">
                              {details.author}
                            </span>
                            {details.authorEmail && (
                              <span className="inspector-author-email">
                                {details.authorEmail}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {details.timestamp && (
                      <div className="inspector-field">
                        <span className="inspector-field-label">Date</span>
                        <span className="inspector-field-value">
                          {new Date(
                            details.timestamp * 1000
                          ).toLocaleString()}
                          <span className="inspector-time-ago">
                            {' '}
                            ({getTimeAgo(details.timestamp)})
                          </span>
                        </span>
                      </div>
                    )}

                    {details.parentHashes && details.parentHashes.length > 0 && (
                      <div className="inspector-field">
                        <span className="inspector-field-label">
                          {details.parentHashes.length > 1
                            ? 'Parents'
                            : 'Parent'}
                        </span>
                        <span className="inspector-field-value mono">
                          {details.parentHashes
                            .map((h) => h.substring(0, 7))
                            .join(', ')}
                        </span>
                      </div>
                    )}
                  </motion.div>
                )}

                {/* Commit message */}
                {details.message && (
                  <motion.div
                    className="inspector-section"
                    variants={sectionVariants}
                  >
                    <div className="inspector-section-title">
                      Message
                      {details.hash && !isEditingMessage && (
                        <button
                          className="inspector-edit-btn"
                          title="Edit commit message"
                          onClick={() => {
                            if (showEditConfirm) {
                              // Already showing confirm, just open editor
                              setShowEditConfirm(false);
                              setEditedMessage(details.message ?? '');
                              setIsEditingMessage(true);
                            } else {
                              setEditedMessage(details.message ?? '');
                              setShowEditConfirm(true);
                            }
                          }}
                        >
                          <img src={EditIcon} style={{ width: '1.2em', height: '1.2em' }} alt="Edit" />
                        </button>
                      )}
                    </div>

                    <AnimatePresence mode="wait">
                      {showEditConfirm && !isEditingMessage ? (
                        <motion.div
                          key="confirm"
                          className="inspector-edit-confirm"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <div className="inspector-edit-warning">
                            <span className="inspector-edit-warning-icon">⚠️</span>
                            <span>
                              Editing a commit message <strong>rewrites Git history</strong>.
                              {headHash !== details.hash && ' This will trigger an interactive rebase.'}
                              {' '}Are you sure?
                            </span>
                          </div>
                          <div className="inspector-edit-confirm-actions">
                            <button
                              className="inspector-edit-confirm-btn proceed"
                              onClick={() => {
                                setShowEditConfirm(false);
                                setIsEditingMessage(true);
                              }}
                            >
                              Yes, Edit
                            </button>
                            <button
                              className="inspector-edit-confirm-btn cancel"
                              onClick={() => setShowEditConfirm(false)}
                            >
                              Cancel
                            </button>
                          </div>
                        </motion.div>
                      ) : isEditingMessage ? (
                        <motion.div
                          key="editor"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                        >
                          <textarea
                            className="inspector-message-editor"
                            value={editedMessage}
                            onChange={(e) => setEditedMessage(e.target.value)}
                            autoFocus
                            rows={4}
                          />
                          <div className="inspector-edit-confirm-actions">
                            <button
                              className="inspector-edit-confirm-btn proceed"
                              disabled={!editedMessage.trim() || editedMessage === details.message}
                              onClick={() => {
                                postMessage({
                                  type: 'reword-commit',
                                  hash: details.hash!,
                                  newMessage: editedMessage.trim(),
                                });
                                setIsEditingMessage(false);
                                setEditedMessage('');
                              }}
                            >
                              Save
                            </button>
                            <button
                              className="inspector-edit-confirm-btn cancel"
                              onClick={() => {
                                setIsEditingMessage(false);
                                setEditedMessage('');
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="display"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                        >
                          <div className="inspector-message">{details.message}</div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}

                {/* GitHub Context */}
                {githubContext && details.hash && (() => {
                  const ciStatus = githubContext.commitStatuses[details.hash];
                  const prs: GitHubPullRequest[] = [];
                  
                  const graphNode = useGraphStore.getState().graphNodes.get(details.nodeId);
                  
                  if (graphNode && graphNode.kind === 'commit') {
                    const commitData = graphNode.data as unknown as CommitNodeData;
                    for (const branch of commitData.branches) {
                      const branchName = branch.replace('origin/', '');
                      const pr = githubContext.pullRequests[branchName];
                      if (pr && !prs.some(p => p.number === pr.number)) prs.push(pr);
                    }
                  }

                  if (!ciStatus && prs.length === 0) return null;

                  return (
                    <motion.div
                      className="inspector-section"
                      variants={sectionVariants}
                    >
                      <div className="inspector-section-title">GitHub</div>
                      
                      {ciStatus && (
                        <div className="inspector-field">
                          <span className="inspector-field-label">Status</span>
                          <span className="inspector-field-value">
                            <span className={`github-badge ci-status ${ciStatus.state}`}>
                              {ciStatus.state === 'success' ? '✔️' : ciStatus.state === 'failure' ? '❌' : '⏳'}
                            </span>
                            {' '}
                            {ciStatus.description && <span className="text-muted">{ciStatus.description}</span>}
                          </span>
                        </div>
                      )}

                      {prs.length > 0 && (
                        <div className="inspector-field" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
                          <span className="inspector-field-label">Pull Requests</span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {prs.map(pr => (
                              <a 
                                key={pr.number} 
                                href={pr.url} 
                                target="_blank" 
                                rel="noreferrer"
                                className="github-pr-link"
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)', textDecoration: 'none' }}
                              >
                                <span className="github-badge pr">#{pr.number}</span>
                                <span>{pr.title}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </motion.div>
                  );
                })()}

                {/* Working Directory Commit & Staging Panel */}
                {details.kind === 'working-directory' && (() => {
                  const wdStatus = details.workingDirectoryStatus;
                  const stagedFiles = wdStatus?.staged ?? [];
                  const modifiedFiles = wdStatus?.modified ?? [];
                  const untrackedFiles = wdStatus?.untracked ?? [];
                  const conflictedFiles = wdStatus?.conflicted ?? [];

                  const allFiles: { path: string; status: string; isStaged: boolean; statusLetter: string }[] = [
                    ...stagedFiles.map((f) => ({
                      path: f.path,
                      status: f.status,
                      isStaged: true,
                      statusLetter: getStatusLetter(f.status),
                    })),
                    ...modifiedFiles
                      .filter((m) => !stagedFiles.some((s) => s.path === m.path))
                      .map((f) => ({
                        path: f.path,
                        status: f.status,
                        isStaged: false,
                        statusLetter: getStatusLetter(f.status),
                      })),
                    ...untrackedFiles
                      .filter((u) => {
                        const uPath = typeof u === 'string' ? u : (u as { path: string }).path;
                        return !stagedFiles.some((s) => s.path === uPath);
                      })
                      .map((f) => {
                        const uPath = typeof f === 'string' ? f : (f as { path: string }).path;
                        return {
                          path: uPath,
                          status: 'untracked',
                          isStaged: false,
                          statusLetter: 'U',
                        };
                      }),
                  ];

                  const stagedCount = stagedFiles.length;
                  const totalCount = allFiles.length + conflictedFiles.length;

                  return (
                    <motion.div
                      className="inspector-section commit-panel-card"
                      variants={sectionVariants}
                    >
                      <div className="inspector-section-title">
                        Commit Changes
                      </div>

                      {/* Message Input Box + AI Generate Button */}
                      <div className="commit-input-wrapper">
                        <textarea
                          className="commit-textarea"
                          placeholder="Message (Ctrl+Enter to commit)..."
                          value={commitInputMessage}
                          onChange={(e) => setCommitInputMessage(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                              e.preventDefault();
                              if (commitInputMessage.trim()) {
                                postMessage({ type: 'commit-staged', message: commitInputMessage.trim() });
                                setCommitInputMessage('');
                              }
                            }
                          }}
                          rows={3}
                        />
                        <button
                          className="generate-ai-btn"
                          disabled={isGeneratingMessage || totalCount === 0}
                          onClick={() => {
                            setIsGeneratingMessage(true);
                            postMessage({ type: 'generate-commit-message' });
                          }}
                          title="Generate commit message using AI"
                        >
                          {isGeneratingMessage ? 'Generating...' : 'Generate 🪄'}
                        </button>
                      </div>

                      {/* Primary Commit Button */}
                      <button
                        className="primary-commit-btn"
                        disabled={!commitInputMessage.trim() || totalCount === 0}
                        onClick={() => {
                          if (commitInputMessage.trim()) {
                            postMessage({ type: 'commit-staged', message: commitInputMessage.trim() });
                            setCommitInputMessage('');
                          }
                        }}
                      >
                        ✓ Commit to {currentBranch ?? 'HEAD'} ({stagedCount > 0 ? `${stagedCount} staged` : `${totalCount} all`})
                      </button>

                      {/* Conflicted Files Section */}
                      {conflictedFiles.length > 0 && (
                        <div className="changes-section conflicted-section">
                          <div className="changes-header" style={{ borderBottomColor: 'rgba(248, 81, 73, 0.3)' }}>
                            <div className="changes-title-group">
                              <span className="changes-title" style={{ color: '#f85149' }}>Conflicted</span>
                              <span className="changes-count-badge" style={{ background: 'rgba(248, 81, 73, 0.15)', color: '#f85149' }}>
                                {conflictedFiles.length}
                              </span>
                            </div>
                          </div>
                          <div className="changes-file-list">
                            {conflictedFiles.map((file) => (
                              <div key={file.path} className="file-change-row is-conflicted">
                                <span className="file-icon">{getFileIcon(file.path)}</span>
                                <span
                                  className="file-path"
                                  title={file.path}
                                  onClick={() => postMessage({ type: 'open-file', path: file.path })}
                                >
                                  <span className="file-basename">{getBasename(file.path)}</span>
                                  <span className="file-dir">{getDirname(file.path)}</span>
                                </span>
                                <span className="file-status-tag conflicted" style={{ color: '#f85149', background: 'transparent' }}>
                                  !
                                </span>
                                <div className="file-row-actions">
                                  <button
                                    className="row-action-btn"
                                    title="Open Merge Editor"
                                    onClick={() => postMessage({ type: 'open-file', path: file.path })}
                                  >
                                    Resolve
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Collapsible Changes List */}
                      <div className="changes-section">
                        <div className="changes-header">
                          <div className="changes-title-group">
                            <span className="changes-title">Changes</span>
                            <span className="changes-count-badge">{totalCount}</span>
                          </div>
                          <div className="changes-header-actions">
                            <button
                              className="icon-action-btn discard"
                              title="Discard All Changes"
                              onClick={() => postMessage({ type: 'discard-all' })}
                            >
                              ↺
                            </button>
                            <button
                              className="icon-action-btn"
                              title="Stage All Changes"
                              onClick={() => postMessage({ type: 'stage-all' })}
                            >
                              +
                            </button>
                            <button
                              className="icon-action-btn"
                              title="Unstage All Changes"
                              onClick={() => postMessage({ type: 'unstage-all' })}
                            >
                              −
                            </button>
                          </div>
                        </div>

                        <div className="changes-file-list">
                          {allFiles.map((file) => (
                            <div
                              key={file.path}
                              className={`file-change-row ${file.isStaged ? 'is-staged' : ''}`}
                            >
                              <input
                                type="checkbox"
                                className="file-checkbox"
                                checked={file.isStaged}
                                onChange={() => {
                                  if (file.isStaged) {
                                    postMessage({ type: 'unstage-file', path: file.path });
                                  } else {
                                    postMessage({ type: 'stage-file', path: file.path });
                                  }
                                }}
                              />
                              <span className="file-icon">{getFileIcon(file.path)}</span>
                              <span
                                className="file-path"
                                title={file.path}
                                onClick={() => postMessage({ type: 'open-file', path: file.path })}
                              >
                                <span className="file-basename">{getBasename(file.path)}</span>
                                <span className="file-dir">{getDirname(file.path)}</span>
                              </span>
                              <span className={`file-status-tag ${file.status}`}>
                                {file.statusLetter}
                              </span>
                              <div className="file-row-actions">
                                <button
                                  className="row-action-btn"
                                  title={file.isStaged ? 'Unstage' : 'Stage'}
                                  onClick={() => {
                                    if (file.isStaged) {
                                      postMessage({ type: 'unstage-file', path: file.path });
                                    } else {
                                      postMessage({ type: 'stage-file', path: file.path });
                                    }
                                  }}
                                >
                                  {file.isStaged ? '−' : '+'}
                                </button>
                                <button
                                  className="row-action-btn discard"
                                  title="Discard Changes"
                                  onClick={() => postMessage({ type: 'discard-file', path: file.path })}
                                >
                                  ↺
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  );
                })()}

                {/* Diff stats for regular commits */}
                {details.kind !== 'working-directory' && details.diffStats && details.diffStats.length > 0 && (
                  <motion.div
                    className="inspector-section"
                    variants={sectionVariants}
                  >
                    <div className="inspector-section-title">
                      Changes
                      <span className="inspector-section-badge">
                        {details.totalFilesChanged} file
                        {details.totalFilesChanged !== 1 ? 's' : ''}
                      </span>
                    </div>

                    <div className="inspector-diff-summary">
                      <span className="diff-summary-add">
                        +{details.totalInsertions}
                      </span>
                      <span className="diff-summary-del">
                        −{details.totalDeletions}
                      </span>
                    </div>

                    <div className="inspector-diff-list">
                      {details.diffStats.map((stat) => (
                        <DiffStatBar
                          key={stat.path}
                          stat={stat}
                          maxChanges={maxChanges}
                          commitHash={details.hash}
                        />
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* Actions */}
                {validActions.length > 0 && (
                  <motion.div
                    className="inspector-section"
                    variants={sectionVariants}
                  >
                    <div className="inspector-section-title">Actions</div>
                    <div className="inspector-actions-grid">
                      {validActions.map((action) => (
                        <ActionButton
                          key={action.kind}
                          action={action}
                          onAction={handleAction}
                        />
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* Action Preview Panel rendered into a Portal */}
                {typeof document !== 'undefined' &&
                  createPortal(
                    <AnimatePresence>
                      {pendingAction && details && (
                        <ActionPreviewPanel
                          action={pendingAction}
                          nodeDetails={details}
                          headHash={headHash}
                          currentBranch={currentBranch}
                          mergeability={mergeability}
                          isCheckingMerge={isCheckingMerge}
                          onProceed={handleProceed}
                          onCancel={handleCancel}
                        />
                      )}
                    </AnimatePresence>,
                    document.body
                  )}
              </motion.div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const sectionVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

function getKindIcon(kind?: string): string {
  const icons: Record<string, string> = {
    commit: '●',
    branch: '⎇',
    'remote-branch': '☁',
    tag: '🏷',
    stash: '📦',
    'working-directory': '📂',
    index: '📋',
    'detached-head': '⚠',
    'merge-state': '⤵',
    'rebase-state': '⤴',
    'cherry-pick-state': '🍒',
  };
  return icons[kind ?? ''] ?? '●';
}

function getTimeAgo(unixTimestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixTimestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}mo ago`;
  return `${Math.floor(diff / 31536000)}y ago`;
}

function getBasename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts.pop() || path;
}

function getDirname(path: string): string {
  const parts = path.split(/[/\\]/);
  parts.pop();
  return parts.length > 0 ? parts.join('\\') : '';
}

function getStatusLetter(status: string): string {
  switch (status) {
    case 'modified': return 'M';
    case 'added': return 'A';
    case 'deleted': return 'D';
    case 'renamed': return 'R';
    case 'conflicted': return '!';
    case 'untracked': return 'U';
    default: return 'M';
  }
}

function getFileIcon(path: string): ReactNode {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts': case 'tsx': return '🟦';
    case 'js': case 'jsx': return '🟨';
    case 'css': case 'scss': return '{}';
    case 'json': return '⚙️';
    case 'md': return '📝';
    case 'html': return <img src={GlobeIcon} style={{ width: '1.2em', height: '1.2em', verticalAlign: 'middle' }} alt="HTML" />;
    case 'py': return '🐍';
    default: return '📄';
  }
}
