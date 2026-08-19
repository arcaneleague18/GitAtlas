/**
 * ActionPreviewPanel — Confirmation overlay for Git actions.
 *
 * Shows before execution:
 * - Action name + icon
 * - Plain-English description of what will happen
 * - Graph impact summary (textual before → after)
 * - Warning for dangerous actions
 * - Proceed / Cancel buttons
 */

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { ValidAction, EdgeKind, NodeDetails } from '../types';

interface ActionPreviewPanelProps {
  action: ValidAction;
  nodeDetails: NodeDetails;
  headHash: string;
  currentBranch: string | null;
  onProceed: () => void;
  onCancel: () => void;
}

const ACTION_ICONS: Record<string, string> = {
  switch: '↗',
  branch: '⎇',
  tag: '🏷',
  merge: '⤵',
  rebase: '⤴',
  'cherry-pick': '🍒',
  reset: '⟲',
  'reset-soft': '⟲',
  'reset-mixed': '⟲',
  revert: '↩',
  push: '↑',
  pull: '↓',
  fetch: '↓',
  commit: '✓',
  'delete-branch': '✕',
  'create-tag': '🏷',
  stash: '📦',
  'apply-stash': '📤',
  'pop-stash': '📤',
};

function ActionPreviewPanelComponent({
  action,
  nodeDetails,
  headHash,
  currentBranch,
  onProceed,
  onCancel,
}: ActionPreviewPanelProps) {
  const icon = ACTION_ICONS[action.kind] ?? '⚡';
  const shortHead = headHash?.substring(0, 7) ?? '???';
  const targetShort = nodeDetails.hash?.substring(0, 7) ?? nodeDetails.label;

  const graphImpact = useMemo(
    () => getGraphImpact(action.kind, nodeDetails, shortHead, currentBranch, targetShort),
    [action.kind, nodeDetails, shortHead, currentBranch, targetShort]
  );

  return (
    <motion.div
      className="action-preview-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onCancel}
    >
      <motion.div
        className="action-preview-overlay"
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()} // Prevent closing when clicking the panel
      >
      {/* Header */}
      <div className="action-preview-header">
        <span className="action-preview-icon">{icon}</span>
        <span className="action-preview-title">{action.label}</span>
      </div>

      {/* Description */}
      <div className="action-preview-section">
        <div className="action-preview-section-label">What this does</div>
        <div className="action-preview-description">{action.description}</div>
      </div>

      {/* Graph Impact */}
      <div className="action-preview-section">
        <div className="action-preview-section-label">Graph Impact</div>
        <div className="action-preview-impact">
          {graphImpact.map((line, i) => (
            <div key={i} className="action-preview-impact-line">
              <span className="action-preview-impact-icon">{line.icon}</span>
              <span>{line.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Danger Warning */}
      {action.isDangerous && (
        <div className="action-preview-warning">
          <span className="action-preview-warning-icon">⚠</span>
          <span>This action is destructive and cannot be easily undone.</span>
        </div>
      )}

      {/* Buttons */}
      <div className="action-preview-buttons">
        <button
          className="action-preview-btn action-preview-btn-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className={`action-preview-btn action-preview-btn-proceed ${
            action.isDangerous ? 'danger' : ''
          }`}
          onClick={onProceed}
        >
          {action.isDangerous ? '⚠ Proceed' : 'Proceed'}
        </button>
      </div>
      </motion.div>
    </motion.div>
  );
}

interface ImpactLine {
  icon: string;
  text: string;
}

function getGraphImpact(
  kind: EdgeKind,
  details: NodeDetails,
  shortHead: string,
  currentBranch: string | null,
  targetShort: string
): ImpactLine[] {
  const branchDisplay = currentBranch ?? `detached at ${shortHead}`;

  switch (kind) {
    case 'switch':
      return [
        { icon: '→', text: `HEAD will move from ${branchDisplay} to ${details.label}` },
        { icon: '📂', text: 'Working directory files will be updated to match' },
      ];

    case 'branch':
      return [
        { icon: '⎇', text: `A new branch will be created at commit ${targetShort}` },
        { icon: '●', text: 'No changes to your current working directory' },
      ];

    case 'merge':
      return [
        { icon: '⤵', text: `${details.label} will be merged into ${branchDisplay}` },
        { icon: '●', text: 'A new merge commit will be created on the current branch' },
        { icon: '📂', text: 'Working directory may have conflicts to resolve' },
      ];

    case 'rebase':
      return [
        { icon: '⤴', text: `Current branch will be replayed on top of ${details.label}` },
        { icon: '●', text: 'Commit hashes will change (history rewrite)' },
        { icon: '⚠', text: 'Force push may be needed if already pushed' },
      ];

    case 'cherry-pick':
      return [
        { icon: '🍒', text: `Commit ${targetShort} will be copied onto ${branchDisplay}` },
        { icon: '●', text: 'A new commit with the same changes will be created' },
      ];

    case 'revert':
      return [
        { icon: '↩', text: `Changes from ${targetShort} will be undone` },
        { icon: '●', text: 'A new revert commit will be created on the current branch' },
      ];

    case 'reset':
      return [
        { icon: '⟲', text: `HEAD will move back to ${targetShort}` },
        { icon: '🗑', text: 'All commits after this point become unreachable' },
        { icon: '⚠', text: 'Working directory changes will be LOST (hard reset)' },
      ];

    case 'reset-soft':
      return [
        { icon: '⟲', text: `HEAD will move back to ${targetShort}` },
        { icon: '📋', text: 'All changes will remain staged (ready to commit)' },
      ];

    case 'reset-mixed':
      return [
        { icon: '⟲', text: `HEAD will move back to ${targetShort}` },
        { icon: '📂', text: 'All changes will be unstaged but preserved in working directory' },
      ];

    case 'delete-branch':
      return [
        { icon: '✕', text: `Branch ${details.label} will be deleted` },
        { icon: '●', text: 'Commits unique to this branch may become unreachable' },
      ];

    case 'create-tag':
      return [
        { icon: '🏷', text: `A tag will be created at commit ${targetShort}` },
        { icon: '●', text: 'Tags are permanent markers in the history' },
      ];

    case 'push':
      return [
        { icon: '↑', text: `Local commits will be pushed to the remote` },
        { icon: '☁', text: 'Remote branch will be updated to match local' },
      ];

    case 'fetch':
      return [
        { icon: '↓', text: 'Latest changes will be downloaded from remote' },
        { icon: '●', text: 'No changes to your local branches or working directory' },
      ];

    case 'stash':
      return [
        { icon: '📦', text: 'Your uncommitted changes will be saved temporarily' },
        { icon: '📂', text: 'Working directory will be cleaned to match HEAD' },
      ];

    case 'apply-stash':
    case 'pop-stash':
      return [
        { icon: '📤', text: 'Stashed changes will be restored to working directory' },
        { icon: kind === 'pop-stash' ? '🗑' : '●', text: kind === 'pop-stash' ? 'The stash entry will be removed' : 'The stash entry will be kept' },
      ];

    case 'commit':
      return [
        { icon: '✓', text: 'A new commit will be created from staged changes' },
        { icon: '●', text: `It will become the new HEAD on ${branchDisplay}` },
      ];

    default:
      return [
        { icon: '⚡', text: `${kind} will be executed on ${details.label}` },
      ];
  }
}

export const ActionPreviewPanel = React.memo(ActionPreviewPanelComponent);
