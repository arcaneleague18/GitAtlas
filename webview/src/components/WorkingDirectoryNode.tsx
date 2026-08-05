/**
 * WorkingDirectoryNode — Custom React Flow node for uncommitted changes.
 *
 * Features:
 * - Dashed border to distinguish from commit nodes
 * - File change count badges (staged, modified, untracked)
 * - Distinct icon and color scheme
 * - Click to inspect changed files
 * - Only appears when there are actual changes
 */

import React, { useState, useCallback } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { motion } from 'framer-motion';
import type { FileChange } from '../types';

interface WDNodeDataType {
  kind: 'working-directory';
  modified: readonly FileChange[];
  staged: readonly FileChange[];
  untracked: readonly string[];
  conflicted: readonly FileChange[];
  isSelected: boolean;
}

function WorkingDirectoryNodeComponent({ data }: NodeProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const nodeData = data as unknown as WDNodeDataType;

  const modifiedCount = nodeData.modified?.length ?? 0;
  const stagedCount = nodeData.staged?.length ?? 0;
  const untrackedCount = nodeData.untracked?.length ?? 0;
  const conflictedCount = nodeData.conflicted?.length ?? 0;
  const totalCount = modifiedCount + stagedCount + untrackedCount + conflictedCount;

  const handleMouseEnter = useCallback(() => setShowTooltip(true), []);
  const handleMouseLeave = useCallback(() => setShowTooltip(false), []);

  return (
    <motion.div
      className={`wd-node ${nodeData.isSelected ? 'selected' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      layout
    >
      {/* Input handle (from nothing — WD is the topmost node) */}
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

      {/* Icon */}
      <div className={`wd-circle ${conflictedCount > 0 ? 'wd-circle-conflicted' : ''}`}>
        <span className="wd-circle-icon">{conflictedCount > 0 ? '!' : '✎'}</span>
      </div>

      {/* Content */}
      <div className="wd-content">
        <div className="wd-title">Uncommitted Changes</div>
        <div className="wd-badges">
          {stagedCount > 0 && (
            <span className="wd-badge wd-badge-staged" title="Staged files">
              <span className="wd-badge-icon">+</span>
              {stagedCount} staged
            </span>
          )}
          {modifiedCount > 0 && (
            <span className="wd-badge wd-badge-modified" title="Modified files">
              <span className="wd-badge-icon">~</span>
              {modifiedCount} modified
            </span>
          )}
          {untrackedCount > 0 && (
            <span className="wd-badge wd-badge-untracked" title="Untracked files">
              <span className="wd-badge-icon">?</span>
              {untrackedCount} untracked
            </span>
          )}
          {conflictedCount > 0 && (
            <span className="wd-badge wd-badge-conflicted" title="Conflicted files">
              <span className="wd-badge-icon">!</span>
              {conflictedCount} conflicted
            </span>
          )}
        </div>
        <div className="wd-meta">
          {totalCount} file{totalCount !== 1 ? 's' : ''} changed
        </div>
      </div>

      {/* Output handle (to HEAD commit) */}
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
        <div className="node-tooltip wd-tooltip">
          <div className="tooltip-row">
            <span className="tooltip-label">Status</span>
            <span className="tooltip-value">Uncommitted changes</span>
          </div>
          {stagedCount > 0 && (
            <div className="tooltip-row">
              <span className="tooltip-label">Staged</span>
              <span className="tooltip-value" style={{ color: 'var(--text-success)' }}>
                {stagedCount} file{stagedCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          {modifiedCount > 0 && (
            <div className="tooltip-row">
              <span className="tooltip-label">Modified</span>
              <span className="tooltip-value" style={{ color: 'var(--text-warning)' }}>
                {modifiedCount} file{modifiedCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          {untrackedCount > 0 && (
            <div className="tooltip-row">
              <span className="tooltip-label">Untracked</span>
              <span className="tooltip-value" style={{ color: 'var(--text-muted)' }}>
                {untrackedCount} file{untrackedCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          {conflictedCount > 0 && (
            <div className="tooltip-row">
              <span className="tooltip-label">Conflicted</span>
              <span className="tooltip-value" style={{ color: '#f85149' }}>
                {conflictedCount} file{conflictedCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          <div className="tooltip-separator" />
          {nodeData.staged?.length > 0 && (
            <div className="tooltip-row">
              <span className="tooltip-label">Staged files</span>
              <span className="tooltip-value mono">
                {nodeData.staged.map(f => f.path).join(', ')}
              </span>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

export const WorkingDirectoryNode = React.memo(WorkingDirectoryNodeComponent);
