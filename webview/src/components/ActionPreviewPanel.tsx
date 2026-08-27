/**
 * ActionPreviewPanel — Confirmation overlay for Git actions.
 *
 * Shows before execution:
 * - Action name + icon
 * - Mergeability status (for merge/rebase actions)
 * - Plain-English description of what will happen
 * - Graph impact summary (textual before → after)
 * - Warning for dangerous actions
 * - Proceed / Cancel buttons
 */

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import type { ValidAction, EdgeKind, NodeDetails } from '../types';

interface ActionPreviewPanelProps {
  action: ValidAction;
  nodeDetails: NodeDetails;
  headHash: string;
  currentBranch: string | null;
  mergeability?: {
    canMerge: boolean;
    status: 'clean' | 'conflicts' | 'up-to-date' | 'fast-forward' | 'error';
    conflictFiles: string[];
    aheadBehind: { ahead: number; behind: number };
    message: string;
  } | null;
  isCheckingMerge?: boolean;
  onProceed: (extraArgs?: Record<string, any>) => void;
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
  mergeability,
  isCheckingMerge,
  onProceed,
  onCancel,
}: ActionPreviewPanelProps) {
  const icon = ACTION_ICONS[action.kind] ?? '⚡';
  const shortHead = headHash?.substring(0, 7) ?? '???';
  const targetShort = nodeDetails.hash?.substring(0, 7) ?? nodeDetails.label;
  const isMergeAction = action.kind === 'merge' || action.kind === 'rebase';
  const isMergeOnly = action.kind === 'merge';

  // Merge strategy state
  const [mergeStrategy, setMergeStrategy] = useState<'ff' | 'no-ff' | 'ff-only'>('ff');

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
        onClick={(e) => e.stopPropagation()}
      >
      {/* Header */}
      <div className="action-preview-header">
        <span className="action-preview-icon">{icon}</span>
        <span className="action-preview-title">{action.label}</span>
      </div>

      {/* Mergeability Banner */}
      {isMergeAction && (
        <div className={`mergeability-banner ${
          isCheckingMerge ? 'checking' :
          !mergeability ? 'checking' :
          mergeability.canMerge ? 'mergeable' : 'conflict'
        }`}>
          {isCheckingMerge || !mergeability ? (
            <>
              <span className="mergeability-spinner" />
              <span className="mergeability-text">Checking mergeability…</span>
            </>
          ) : (
            <>
              <span className="mergeability-icon">
                {mergeability.canMerge ? '✓' : '✕'}
              </span>
              <span className="mergeability-text">{mergeability.message}</span>
            </>
          )}
        </div>
      )}

      {/* Conflict file list */}
      {isMergeAction && mergeability && !mergeability.canMerge && mergeability.conflictFiles.length > 0 && (
        <div className="mergeability-conflicts">
          <div className="mergeability-conflicts-title">Conflicting files:</div>
          {mergeability.conflictFiles.map((f, i) => (
            <div key={i} className="mergeability-conflict-file">
              <span className="mergeability-conflict-icon">⚠</span>
              <span>{f}</span>
            </div>
          ))}
        </div>
      )}

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

      {/* Git Commands */}
      <div className="action-preview-section">
        <div className="action-preview-section-label">Commands</div>
        <div className="action-preview-commands">
          {getGitCommands(action.kind, nodeDetails, currentBranch, isMergeOnly ? mergeStrategy : undefined, (action as any).args?.pushMode).map((cmd, i) => (
            <div key={i} className="action-preview-command-line">
              <span className="action-preview-command-prompt">$</span>
              <code>{cmd}</code>
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

      {/* Merge Strategy Selector */}
      {isMergeOnly && (
        <div className="action-preview-section">
          <div className="action-preview-section-label">Merge Strategy</div>
          <div className="merge-strategy-options">
            <label className={`merge-strategy-option ${mergeStrategy === 'ff' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="mergeStrategy"
                value="ff"
                checked={mergeStrategy === 'ff'}
                onChange={() => setMergeStrategy('ff')}
              />
              <div className="merge-strategy-content">
                <span className="merge-strategy-name">Fast-forward</span>
                <span className="merge-strategy-desc">Move branch pointer forward when possible, otherwise create merge commit</span>
              </div>
            </label>
            <label className={`merge-strategy-option ${mergeStrategy === 'no-ff' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="mergeStrategy"
                value="no-ff"
                checked={mergeStrategy === 'no-ff'}
                onChange={() => setMergeStrategy('no-ff')}
              />
              <div className="merge-strategy-content">
                <span className="merge-strategy-name">No fast-forward</span>
                <span className="merge-strategy-desc">Always create a merge commit, even if fast-forward is possible</span>
              </div>
            </label>
            <label className={`merge-strategy-option ${mergeStrategy === 'ff-only' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="mergeStrategy"
                value="ff-only"
                checked={mergeStrategy === 'ff-only'}
                onChange={() => setMergeStrategy('ff-only')}
              />
              <div className="merge-strategy-content">
                <span className="merge-strategy-name">Fast-forward only</span>
                <span className="merge-strategy-desc">Merge only if fast-forward is possible, fail otherwise</span>
              </div>
            </label>
          </div>
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
          onClick={() => onProceed(isMergeOnly ? { mergeStrategy } : undefined)}
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

/**
 * Returns the exact git commands that will be executed for a given action.
 */
function getGitCommands(
  kind: EdgeKind,
  details: NodeDetails,
  currentBranch: string | null,
  mergeStrategy?: 'ff' | 'no-ff' | 'ff-only',
  pushMode?: string
): string[] {
  const shortHash = details.hash?.substring(0, 7) ?? details.label;
  const label = details.label;
  // For actions that accept either a branch name or a commit hash,
  // use the branch name if the node is a branch, otherwise use the hash.
  const isBranch = details.kind === 'branch' || details.kind === 'remote-branch';
  const ref = isBranch ? label : shortHash;

  switch (kind) {
    case 'switch':
      // Branches use `git switch`, commits use `git switch --detach`
      return isBranch
        ? [`git switch ${ref}`]
        : [`git switch --detach ${ref}`];

    case 'branch':
      return [`git branch <name> ${shortHash}`];

    case 'delete-branch':
      return [`git branch -D ${label}`];

    case 'delete-remote-branch': {
      const parts = label.split('/');
      const remote = parts[0];
      const branch = parts.slice(1).join('/');
      return [`git push ${remote} --delete ${branch}`];
    }

    case 'merge': {
      const strategyFlag =
        mergeStrategy === 'no-ff' ? ' --no-ff' :
        mergeStrategy === 'ff-only' ? ' --ff-only' : '';
      return [`git merge${strategyFlag} ${ref}`];
    }

    case 'rebase':
      return [`git rebase ${ref}`];

    case 'cherry-pick':
      return [`git cherry-pick ${shortHash}`];

    case 'revert':
      return [`git revert ${shortHash}`];

    case 'reset':
      return [`git reset --hard ${shortHash}`];

    case 'reset-soft':
      return [`git reset --soft ${shortHash}`];

    case 'reset-mixed':
      return [`git reset --mixed ${shortHash}`];

    case 'create-tag':
      return [`git tag <name> ${shortHash}`];

    case 'commit':
      return [`git commit -m "<message>"`];

    case 'stash':
      return [`git stash push -m "<message>"`];

    case 'apply-stash':
      return [`git stash apply stash@{${(details as any).stashIndex ?? 0}}`];

    case 'pop-stash':
      return [`git stash pop stash@{${(details as any).stashIndex ?? 0}}`];

    case 'stash-drop':
      return [`git stash drop stash@{${(details as any).stashIndex ?? 0}}`];

    case 'push': {
      const pushFlag = pushMode === 'force' ? ' --force' : pushMode === 'force-with-lease' ? ' --force-with-lease' : '';
      return currentBranch
        ? [`git push origin ${currentBranch}${pushFlag}`]
        : [`git push${pushFlag}`];
    }

    case 'fetch':
      return [`git fetch --all`];

    case 'delete-commit':
      return [
        `git rebase --onto ${shortHash}^ ${shortHash}`,
      ];

    default:
      return [`git ${kind} ${ref}`];
  }
}

export const ActionPreviewPanel = React.memo(ActionPreviewPanelComponent);
