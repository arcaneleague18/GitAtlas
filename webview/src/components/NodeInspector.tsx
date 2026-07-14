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

import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGraphStore } from '../store/graph.store';
import { postMessage } from '../vscode';
import { DiffStatBar } from './DiffStatBar';
import { ActionButton } from './ActionButton';
import type { EdgeKind, GitHubPullRequest, CommitNodeData } from '../types';

export function NodeInspector() {
  const {
    isInspectorOpen,
    selectedNodeDetails,
    validActions,
    closeInspector,
    githubContext,
  } = useGraphStore();

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isInspectorOpen) {
        closeInspector();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isInspectorOpen, closeInspector]);

  const handleAction = useCallback(
    (kind: EdgeKind) => {
      if (selectedNodeDetails) {
        postMessage({
          type: 'action-requested',
          action: kind,
          nodeId: selectedNodeDetails.nodeId,
        });
      }
    },
    [selectedNodeDetails]
  );

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
                    <div className="inspector-section-title">Message</div>
                    <div className="inspector-message">{details.message}</div>
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

                {/* Diff stats */}
                {details.diffStats && details.diffStats.length > 0 && (
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
