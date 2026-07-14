/**
 * CommitNode — Custom React Flow node for Git commits.
 *
 * Features:
 * - Circular indicator with branch color
 * - Abbreviated hash + first line of commit message
 * - HEAD indicator (pulsing ring animation)
 * - Current branch highlight
 * - Hover tooltip with full details
 * - Branch and tag badges
 * - Performance: wrapped in React.memo
 */

import React, { useState, useCallback } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { motion } from 'framer-motion';
import { useGraphStore } from '../store/graph.store';
import type { GitHubPullRequest } from '../types';

interface CommitNodeDataType {
  kind: 'commit';
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  authorEmail: string;
  timestamp: number;
  parentHashes: readonly string[];
  branches: readonly string[];
  tags: readonly string[];
  filesChanged: number;
  color: string;
  isHead: boolean;
  isCurrentBranch: boolean;
  isSelected: boolean;
}

function CommitNodeComponent({ id, data }: NodeProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const nodeData = data as unknown as CommitNodeDataType;
  
  // Only get the action count if this node is selected
  const validActionsCount = useGraphStore((state) => 
    state.selectedNodeId === id ? state.validActions.length : 0
  );

  const githubContext = useGraphStore((state) => state.githubContext);
  const ciStatus = githubContext?.commitStatuses[nodeData.hash];
  
  const prs: GitHubPullRequest[] = [];
  if (githubContext?.pullRequests) {
    for (const branch of nodeData.branches) {
      const branchName = branch.replace('origin/', '');
      const pr = githubContext.pullRequests[branchName];
      if (pr && !prs.some(p => p.number === pr.number)) prs.push(pr);
    }
  }

  const handleMouseEnter = useCallback(() => setShowTooltip(true), []);
  const handleMouseLeave = useCallback(() => setShowTooltip(false), []);

  const timeAgo = getTimeAgo(nodeData.timestamp);

  return (
    <motion.div
      className={`commit-node ${nodeData.isSelected ? 'selected' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      layout
    >
      {/* Input handle (from children) */}
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: 'transparent',
          border: 'none',
          width: 1,
          height: 1,
        }}
      />

      {/* Commit circle with branch color */}
      <div
        className={`commit-circle ${nodeData.isHead ? 'is-head' : ''}`}
        style={{ backgroundColor: nodeData.color }}
      >
        {nodeData.shortHash.substring(0, 3)}
      </div>

      {/* Content */}
      <div className="commit-content">
        <div className="commit-message">{nodeData.message}</div>
        <div className="commit-meta">
          <span className="commit-hash">{nodeData.shortHash}</span>
          <span className="commit-time">{timeAgo}</span>
          {validActionsCount > 0 && (
            <span className="commit-action-badge">
              {validActionsCount} action{validActionsCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* GitHub Badges */}
        {(ciStatus || prs.length > 0) && (
          <div className="github-badges">
            {ciStatus && (
              <span className={`github-badge ci-status ${ciStatus.state}`} title={ciStatus.description}>
                {ciStatus.state === 'success' ? '✔️' : ciStatus.state === 'failure' ? '❌' : '⏳'}
              </span>
            )}
            {prs.map(pr => (
              <span key={pr.number} className="github-badge pr" title={pr.title}>
                #{pr.number}
              </span>
            ))}
          </div>
        )}

        {/* Branch and tag badges */}
        {(nodeData.branches.length > 0 || nodeData.tags.length > 0) && (
          <div className="branch-labels">
            {nodeData.branches.map((branch) => (
              <span
                key={branch}
                className={`branch-badge ${
                  nodeData.isCurrentBranch && branch === nodeData.branches[0]
                    ? 'current'
                    : branch.includes('/')
                    ? 'remote'
                    : 'local'
                }`}
              >
                <span className="branch-badge-icon">
                  {branch.includes('/') ? '☁' : '⎇'}
                </span>
                {branch}
              </span>
            ))}
            {nodeData.tags.map((tag) => (
              <span key={tag} className="tag-badge">
                <span className="tag-badge-icon">🏷</span>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Output handle (to parents) */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: 'transparent',
          border: 'none',
          width: 1,
          height: 1,
        }}
      />

      {/* Hover Tooltip */}
      {showTooltip && (
        <div className="node-tooltip">
          <div className="tooltip-row">
            <span className="tooltip-label">Hash</span>
            <span className="tooltip-value mono">{nodeData.hash}</span>
          </div>
          <div className="tooltip-row">
            <span className="tooltip-label">Author</span>
            <span className="tooltip-value">{nodeData.author}</span>
          </div>
          <div className="tooltip-row">
            <span className="tooltip-label">Date</span>
            <span className="tooltip-value">
              {new Date(nodeData.timestamp * 1000).toLocaleString()}
            </span>
          </div>
          <div className="tooltip-separator" />
          <div className="tooltip-row">
            <span className="tooltip-label">Message</span>
            <span className="tooltip-value">{nodeData.message}</span>
          </div>
          {nodeData.parentHashes.length > 0 && (
            <div className="tooltip-row">
              <span className="tooltip-label">Parents</span>
              <span className="tooltip-value mono">
                {nodeData.parentHashes.map((h) => h.substring(0, 7)).join(', ')}
              </span>
            </div>
          )}
          {nodeData.branches.length > 0 && (
            <div className="tooltip-row">
              <span className="tooltip-label">Branches</span>
              <span className="tooltip-value">
                {nodeData.branches.join(', ')}
              </span>
            </div>
          )}
          {nodeData.tags.length > 0 && (
            <div className="tooltip-row">
              <span className="tooltip-label">Tags</span>
              <span className="tooltip-value">{nodeData.tags.join(', ')}</span>
            </div>
          )}
          {nodeData.isHead && (
            <>
              <div className="tooltip-separator" />
              <div className="tooltip-row">
                <span className="tooltip-value" style={{ color: 'var(--text-success)' }}>
                  ● HEAD is here
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </motion.div>
  );
}

/**
 * Format a unix timestamp as a human-readable relative time.
 */
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

export const CommitNode = React.memo(CommitNodeComponent);
