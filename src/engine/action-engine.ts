/**
 * Action Engine — computes valid state transitions for any node.
 *
 * This is the state machine logic: given a node in the graph,
 * what Git operations are available, which are disabled (with reasons)?
 *
 * Actions are computed DYNAMICALLY based on the node's kind, its
 * relationship to HEAD, the current branch, repo state, and graph topology.
 */

import type {
  GraphNode,
  RepositoryGraph,
  ValidAction,
  CommitNodeData,
} from './types.js';

/**
 * Get the list of valid actions for a given node in the graph.
 *
 * @param nodeId - The ID of the node to get actions for.
 * @param graph - The current repository graph.
 * @returns Array of ValidAction objects describing what's possible.
 */
export function getValidActions(
  nodeId: string,
  graph: RepositoryGraph
): ValidAction[] {
  const node = graph.nodes.get(nodeId);
  if (!node) return [];

  switch (node.kind) {
    case 'commit':
      return getCommitActions(node, graph);
    case 'branch':
      return getBranchActions(node, graph);
    case 'remote-branch':
      return getRemoteBranchActions(node, graph);
    case 'tag':
      return getTagActions(node, graph);
    case 'stash':
      return getStashActions(node, graph);
    case 'working-directory':
      return getWorkingDirectoryActions(node, graph);
    case 'index':
      return getIndexActions(node, graph);
    case 'detached-head':
      return getDetachedHeadActions(node, graph);
    case 'merge-state':
      return getMergeStateActions(node, graph);
    case 'rebase-state':
      return getRebaseStateActions(node, graph);
    case 'cherry-pick-state':
      return getCherryPickStateActions(node, graph);
    default:
      return [];
  }
}

// ── Commit Actions ─────────────────────────────────────────────

function getCommitActions(node: GraphNode, graph: RepositoryGraph): ValidAction[] {
  const data = node.data as CommitNodeData;
  const actions: ValidAction[] = [];

  const isHead = node.id === graph.headHash;
  const isOnCurrentBranch = node.isCurrentBranch;
  const hasBranches = data.branches.length > 0;
  const hasTags = data.tags.length > 0;
  const isMergeCommit = data.parentHashes.length > 1;
  const isInSpecialState = graph.state === 'merging' || graph.state === 'rebasing' || graph.state === 'cherry-picking';

  // ── Navigation ──

  // Checkout — always available unless already HEAD
  actions.push({
    kind: 'checkout',
    label: 'Checkout',
    description: isHead
      ? 'You are already at this commit'
      : 'Switch to this commit (detached HEAD)',
    enabled: !isHead,
    disabledReason: isHead ? 'HEAD is already at this commit' : undefined,
    isDangerous: false,
  });

  // ── Branching ──

  // Create Branch — always available
  actions.push({
    kind: 'branch',
    label: 'Create Branch',
    description: 'Create a new branch starting from this commit',
    enabled: true,
    isDangerous: false,
  });

  // Create Tag — always available unless already tagged
  actions.push({
    kind: 'create-tag',
    label: 'Create Tag',
    description: hasTags
      ? 'This commit already has tags, but you can add another'
      : 'Tag this commit with a name',
    enabled: true,
    isDangerous: false,
  });

  // ── Integration ──

  // Cherry Pick — available if NOT on the current branch (cherry-picking from current branch is pointless)
  actions.push({
    kind: 'cherry-pick',
    label: 'Cherry Pick',
    description: isHead
      ? 'Cannot cherry-pick HEAD onto itself'
      : isOnCurrentBranch
        ? 'This commit is already on the current branch'
        : 'Copy this commit onto the current branch',
    enabled: !isHead && !isOnCurrentBranch && !isInSpecialState,
    disabledReason: isHead
      ? 'Cannot cherry-pick HEAD onto itself'
      : isOnCurrentBranch
        ? 'Commit is already on the current branch'
        : isInSpecialState
          ? 'Resolve current operation first'
          : undefined,
    isDangerous: false,
  });

  // Merge — available when commit has branches that are not the current branch,
  // or when the commit is not on the current branch (allows merging by hash)
  const mergableBranches = data.branches.filter(
    (b) => b !== graph.currentBranch && !b.includes('/')
  );
  if (mergableBranches.length > 0) {
    actions.push({
      kind: 'merge',
      label: `Merge into ${graph.currentBranch || 'HEAD'}`,
      description: `Merge ${mergableBranches[0]} into your current branch`,
      enabled: !isInSpecialState,
      disabledReason: isInSpecialState ? 'Resolve current operation first' : undefined,
      isDangerous: false,
    });
  } else if (!isHead && !isOnCurrentBranch) {
    // Commit is not a branch tip but is on a different branch — still offer merge by hash
    actions.push({
      kind: 'merge',
      label: `Merge into ${graph.currentBranch || 'HEAD'}`,
      description: `Merge this commit into your current branch`,
      enabled: !isInSpecialState,
      disabledReason: isInSpecialState ? 'Resolve current operation first' : undefined,
      isDangerous: false,
    });
  }

  // Revert — creates a new commit that undoes this one. Available unless HEAD or in special state.
  actions.push({
    kind: 'revert',
    label: 'Revert',
    description: isMergeCommit
      ? 'Create a new commit undoing this merge commit'
      : 'Create a new commit that undoes this commit\'s changes',
    enabled: !isInSpecialState,
    disabledReason: isInSpecialState ? 'Resolve current operation first' : undefined,
    isDangerous: false,
  });

  // Rebase — available when not HEAD and not in special state
  actions.push({
    kind: 'rebase',
    label: 'Rebase onto Here',
    description: isHead
      ? 'Cannot rebase onto the current commit'
      : `Rebase ${graph.currentBranch || 'HEAD'} onto this commit`,
    enabled: !isHead && !isInSpecialState,
    disabledReason: isHead
      ? 'Cannot rebase onto the current commit'
      : isInSpecialState
        ? 'Resolve current operation first'
        : undefined,
    isDangerous: true,
  });

  // ── Reset — offer all three modes ──

  // Reset --soft — keeps changes staged
  actions.push({
    kind: 'reset-soft',
    label: 'Reset (Soft)',
    description: isHead
      ? 'HEAD is already here'
      : 'Move branch pointer here, keep all changes staged',
    enabled: !isHead && !isInSpecialState,
    disabledReason: isHead
      ? 'HEAD is already at this commit'
      : isInSpecialState
        ? 'Resolve current operation first'
        : undefined,
    isDangerous: false,
  });

  // Reset --mixed — keeps changes unstaged
  actions.push({
    kind: 'reset-mixed',
    label: 'Reset (Mixed)',
    description: isHead
      ? 'HEAD is already here'
      : 'Move branch pointer here, keep changes as unstaged modifications',
    enabled: !isHead && !isInSpecialState,
    disabledReason: isHead
      ? 'HEAD is already at this commit'
      : isInSpecialState
        ? 'Resolve current operation first'
        : undefined,
    isDangerous: false,
  });

  // Reset --hard — discards everything
  actions.push({
    kind: 'reset',
    label: 'Reset (Hard)',
    description: isHead
      ? 'HEAD is already here'
      : '⚠️ Move branch pointer here and discard ALL uncommitted changes',
    enabled: !isHead && !isInSpecialState,
    disabledReason: isHead
      ? 'HEAD is already at this commit'
      : isInSpecialState
        ? 'Resolve current operation first'
        : undefined,
    isDangerous: true,
  });

  // ── Branch operations at this commit ──

  // If this commit has local branches, offer to delete each one
  const deletableBranches = data.branches.filter(
    (b) => b !== graph.currentBranch && !b.includes('/')
  );
  for (const branch of deletableBranches) {
    actions.push({
      kind: 'delete-branch',
      label: `Delete Branch "${branch}"`,
      description: `Delete the local branch "${branch}"`,
      enabled: true,
      isDangerous: true,
    });
  }

  // If this commit has branches with an upstream, offer push
  const pushableBranches = data.branches.filter(
    (b) => !b.includes('/') && b !== graph.currentBranch
  );
  // Also offer push for current branch at HEAD
  if (isHead && graph.currentBranch) {
    actions.push({
      kind: 'push',
      label: `Push "${graph.currentBranch}"`,
      description: `Push ${graph.currentBranch} to the remote`,
      enabled: !isInSpecialState,
      disabledReason: isInSpecialState ? 'Resolve current operation first' : undefined,
      isDangerous: false,
    });
  }

  return actions;
}

// ── Branch Actions ─────────────────────────────────────────────

function getBranchActions(node: GraphNode, graph: RepositoryGraph): ValidAction[] {
  const actions: ValidAction[] = [];
  const isCurrent = node.isCurrentBranch;
  const isInSpecialState = graph.state === 'merging' || graph.state === 'rebasing' || graph.state === 'cherry-picking';

  actions.push({
    kind: 'checkout',
    label: 'Checkout',
    description: isCurrent ? 'Already on this branch' : 'Switch to this branch',
    enabled: !isCurrent,
    disabledReason: isCurrent ? 'Already on this branch' : undefined,
    isDangerous: false,
  });

  actions.push({
    kind: 'merge',
    label: 'Merge into Current',
    description: isCurrent
      ? 'Cannot merge a branch into itself'
      : `Merge ${node.label} into ${graph.currentBranch || 'HEAD'}`,
    enabled: !isCurrent && !isInSpecialState,
    disabledReason: isCurrent
      ? 'Cannot merge a branch into itself'
      : isInSpecialState
        ? 'Resolve current operation first'
        : undefined,
    isDangerous: false,
  });

  actions.push({
    kind: 'rebase',
    label: 'Rebase Current onto This',
    description: isCurrent
      ? 'Cannot rebase a branch onto itself'
      : `Rebase ${graph.currentBranch || 'HEAD'} onto ${node.label}`,
    enabled: !isCurrent && !isInSpecialState,
    disabledReason: isCurrent
      ? 'Cannot rebase a branch onto itself'
      : isInSpecialState
        ? 'Resolve current operation first'
        : undefined,
    isDangerous: true,
  });

  actions.push({
    kind: 'delete-branch',
    label: 'Delete Branch',
    description: isCurrent
      ? 'Cannot delete the current branch'
      : `Delete the local branch "${node.label}"`,
    enabled: !isCurrent,
    disabledReason: isCurrent ? 'Cannot delete the currently checked out branch' : undefined,
    isDangerous: true,
  });

  actions.push({
    kind: 'push',
    label: 'Push',
    description: `Push ${node.label} to the remote`,
    enabled: !isInSpecialState,
    disabledReason: isInSpecialState ? 'Resolve current operation first' : undefined,
    isDangerous: false,
  });

  actions.push({
    kind: 'branch',
    label: 'Create Branch from Here',
    description: `Create a new branch from the tip of ${node.label}`,
    enabled: true,
    isDangerous: false,
  });

  return actions;
}

// ── Remote Branch Actions ──────────────────────────────────────

function getRemoteBranchActions(node: GraphNode, graph: RepositoryGraph): ValidAction[] {
  const actions: ValidAction[] = [];
  const isInSpecialState = graph.state === 'merging' || graph.state === 'rebasing' || graph.state === 'cherry-picking';

  actions.push({
    kind: 'checkout',
    label: 'Checkout',
    description: 'Create a local branch tracking this remote branch',
    enabled: true,
    isDangerous: false,
  });

  actions.push({
    kind: 'fetch',
    label: 'Fetch',
    description: 'Fetch latest changes from the remote',
    enabled: true,
    isDangerous: false,
  });

  actions.push({
    kind: 'merge',
    label: 'Merge into Current',
    description: `Merge ${node.label} into ${graph.currentBranch || 'HEAD'}`,
    enabled: !isInSpecialState,
    disabledReason: isInSpecialState ? 'Resolve current operation first' : undefined,
    isDangerous: false,
  });

  actions.push({
    kind: 'rebase',
    label: 'Rebase onto Remote',
    description: `Rebase ${graph.currentBranch || 'HEAD'} onto ${node.label}`,
    enabled: !isInSpecialState,
    disabledReason: isInSpecialState ? 'Resolve current operation first' : undefined,
    isDangerous: true,
  });

  actions.push({
    kind: 'branch',
    label: 'Create Branch from Here',
    description: `Create a new local branch from ${node.label}`,
    enabled: true,
    isDangerous: false,
  });

  return actions;
}

// ── Tag Actions ────────────────────────────────────────────────

function getTagActions(_node: GraphNode, _graph: RepositoryGraph): ValidAction[] {
  return [
    {
      kind: 'checkout',
      label: 'Checkout',
      description: 'Switch to this tag (detached HEAD)',
      enabled: true,
      isDangerous: false,
    },
    {
      kind: 'branch',
      label: 'Create Branch from Tag',
      description: 'Create a new branch starting from this tag',
      enabled: true,
      isDangerous: false,
    },
    {
      kind: 'delete-branch',
      label: 'Delete Tag',
      description: 'Remove this tag',
      enabled: true,
      isDangerous: true,
    },
  ];
}

// ── Stash Actions ──────────────────────────────────────────────

function getStashActions(_node: GraphNode, _graph: RepositoryGraph): ValidAction[] {
  return [
    {
      kind: 'apply-stash',
      label: 'Apply',
      description: 'Apply this stash without removing it',
      enabled: true,
      isDangerous: false,
    },
    {
      kind: 'pop-stash',
      label: 'Pop',
      description: 'Apply this stash and remove it from the stash list',
      enabled: true,
      isDangerous: false,
    },
    {
      kind: 'branch',
      label: 'Create Branch from Stash',
      description: 'Create a new branch from this stash and apply it',
      enabled: true,
      isDangerous: false,
    },
  ];
}

// ── Working Directory Actions ──────────────────────────────────

function getWorkingDirectoryActions(_node: GraphNode, _graph: RepositoryGraph): ValidAction[] {
  return [
    {
      kind: 'commit',
      label: 'Commit',
      description: 'Create a new commit from staged changes',
      enabled: true,
      isDangerous: false,
    },
    {
      kind: 'stash',
      label: 'Stash',
      description: 'Save your changes temporarily',
      enabled: true,
      isDangerous: false,
    },
  ];
}

// ── Index Actions ──────────────────────────────────────────────

function getIndexActions(_node: GraphNode, _graph: RepositoryGraph): ValidAction[] {
  return [
    {
      kind: 'commit',
      label: 'Commit',
      description: 'Create a new commit from staged changes',
      enabled: true,
      isDangerous: false,
    },
  ];
}

// ── Detached Head Actions ──────────────────────────────────────

function getDetachedHeadActions(_node: GraphNode, _graph: RepositoryGraph): ValidAction[] {
  return [
    {
      kind: 'branch',
      label: 'Create Branch',
      description: 'Create a new branch at the current position to save your work',
      enabled: true,
      isDangerous: false,
    },
    {
      kind: 'checkout',
      label: 'Checkout Branch',
      description: 'Switch to an existing branch',
      enabled: true,
      isDangerous: false,
    },
    {
      kind: 'stash',
      label: 'Stash Changes',
      description: 'Save your uncommitted changes before switching',
      enabled: true,
      isDangerous: false,
    },
  ];
}

// ── Merge State Actions ────────────────────────────────────────

function getMergeStateActions(_node: GraphNode, _graph: RepositoryGraph): ValidAction[] {
  return [
    {
      kind: 'commit',
      label: 'Complete Merge',
      description: 'Finish the merge by committing resolved changes',
      enabled: true,
      isDangerous: false,
    },
    {
      kind: 'reset',
      label: 'Abort Merge',
      description: 'Cancel the merge and restore original state',
      enabled: true,
      isDangerous: true,
    },
  ];
}

// ── Rebase State Actions ───────────────────────────────────────

function getRebaseStateActions(_node: GraphNode, _graph: RepositoryGraph): ValidAction[] {
  return [
    {
      kind: 'commit',
      label: 'Continue Rebase',
      description: 'Continue to the next step of the rebase',
      enabled: true,
      isDangerous: false,
    },
    {
      kind: 'reset',
      label: 'Abort Rebase',
      description: 'Cancel the rebase and restore original state',
      enabled: true,
      isDangerous: true,
    },
  ];
}

// ── Cherry Pick State Actions ──────────────────────────────────

function getCherryPickStateActions(_node: GraphNode, _graph: RepositoryGraph): ValidAction[] {
  return [
    {
      kind: 'commit',
      label: 'Continue Cherry Pick',
      description: 'Continue the cherry pick after resolving conflicts',
      enabled: true,
      isDangerous: false,
    },
    {
      kind: 'reset',
      label: 'Abort Cherry Pick',
      description: 'Cancel the cherry pick',
      enabled: true,
      isDangerous: true,
    },
  ];
}
