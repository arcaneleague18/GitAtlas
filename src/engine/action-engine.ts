/**
 * Action Engine — computes valid state transitions for any node.
 *
 * This is the state machine logic: given a node in the graph,
 * what Git operations are available, and which are disabled (with reasons)?
 *
 * Phase 1: Returns hardcoded valid actions per node kind.
 * Phase 3: Will compute actions dynamically based on graph topology.
 */

import type {
  GraphNode,
  RepositoryGraph,
  ValidAction,
  NodeKind,
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

  return getActionsForKind(node, graph);
}

/**
 * Get actions based on node kind — the state machine transition table.
 */
function getActionsForKind(
  node: GraphNode,
  _graph: RepositoryGraph
): ValidAction[] {
  const actions = ACTIONS_BY_KIND[node.kind];
  if (!actions) return [];

  return actions.map((action) => ({
    ...action,
    // Phase 3: dynamically compute enabled/disabled based on graph state
    enabled: action.enabled,
  }));
}

/**
 * Static action definitions per node kind.
 * Phase 3 will make these dynamic based on graph topology.
 */
const ACTIONS_BY_KIND: Record<NodeKind, ValidAction[]> = {
  'commit': [
    {
      kind: 'checkout',
      label: 'Checkout',
      description: 'Switch to this commit (detached HEAD)',
      enabled: true,
      isDangerous: false,
    },
    {
      kind: 'branch',
      label: 'Create Branch',
      description: 'Create a new branch starting from this commit',
      enabled: true,
      isDangerous: false,
    },
    {
      kind: 'tag',
      label: 'Create Tag',
      description: 'Tag this commit with a name',
      enabled: true,
      isDangerous: false,
    },
    {
      kind: 'cherry-pick',
      label: 'Cherry Pick',
      description: 'Copy this commit onto the current branch',
      enabled: true,
      isDangerous: false,
    },
    {
      kind: 'reset',
      label: 'Reset to Here',
      description: 'Move the current branch pointer to this commit',
      enabled: true,
      isDangerous: true,
    },
    {
      kind: 'rebase',
      label: 'Rebase onto Here',
      description: 'Rebase the current branch onto this commit',
      enabled: true,
      isDangerous: true,
    },
  ],

  'branch': [
    {
      kind: 'checkout',
      label: 'Checkout',
      description: 'Switch to this branch',
      enabled: true,
      isDangerous: false,
    },
    {
      kind: 'merge',
      label: 'Merge into Current',
      description: 'Merge this branch into the current branch',
      enabled: true,
      isDangerous: false,
    },
    {
      kind: 'rebase',
      label: 'Rebase Current onto This',
      description: 'Rebase the current branch onto this branch',
      enabled: true,
      isDangerous: true,
    },
    {
      kind: 'delete-branch',
      label: 'Delete',
      description: 'Delete this branch',
      enabled: true,
      isDangerous: true,
    },
    {
      kind: 'push',
      label: 'Push',
      description: 'Push this branch to the remote',
      enabled: true,
      isDangerous: false,
    },
  ],

  'remote-branch': [
    {
      kind: 'checkout',
      label: 'Checkout',
      description: 'Create a local branch tracking this remote branch',
      enabled: true,
      isDangerous: false,
    },
    {
      kind: 'fetch',
      label: 'Fetch',
      description: 'Fetch latest changes from the remote',
      enabled: true,
      isDangerous: false,
    },
    {
      kind: 'merge',
      label: 'Merge into Current',
      description: 'Merge this remote branch into the current branch',
      enabled: true,
      isDangerous: false,
    },
  ],

  'tag': [
    {
      kind: 'checkout',
      label: 'Checkout',
      description: 'Switch to this tag (detached HEAD)',
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
  ],

  'stash': [
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
  ],

  'working-directory': [
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
  ],

  'index': [
    {
      kind: 'commit',
      label: 'Commit',
      description: 'Create a new commit from staged changes',
      enabled: true,
      isDangerous: false,
    },
  ],

  'detached-head': [
    {
      kind: 'branch',
      label: 'Create Branch',
      description: 'Create a new branch at the current position',
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
  ],

  'merge-state': [
    {
      kind: 'commit',
      label: 'Complete Merge',
      description: 'Finish the merge by committing',
      enabled: true,
      isDangerous: false,
    },
    {
      kind: 'reset',
      label: 'Abort Merge',
      description: 'Cancel the merge and go back',
      enabled: true,
      isDangerous: true,
    },
  ],

  'rebase-state': [
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
  ],

  'cherry-pick-state': [
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
  ],
};
