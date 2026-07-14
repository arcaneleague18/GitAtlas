/**
 * Error Parser — converts raw Git stderr into user-friendly explanations.
 */

export interface GitError {
  message: string;
  reason: string;
  nextSteps: string;
  rawStderr: string;
}

/**
 * Parses raw git stderr and returns a structured GitError.
 */
export function parseGitError(stderr: string, action: string): GitError {
  const lowerErr = stderr.toLowerCase();

  // 1. Merge / Rebase Conflicts
  if (lowerErr.includes('conflict') || lowerErr.includes('automatic merge failed')) {
    return {
      message: `${capitalize(action)} resulted in conflicts.`,
      reason: 'Git could not automatically resolve differences between the branches.',
      nextSteps: 'Resolve the conflicts in the affected files, then commit the results to finish the merge.',
      rawStderr: stderr,
    };
  }

  // 2. Dirty Working Tree
  if (
    lowerErr.includes('your local changes to the following files would be overwritten') ||
    lowerErr.includes('please commit your changes or stash them')
  ) {
    return {
      message: `Cannot ${action} because you have uncommitted changes.`,
      reason: 'The operation would overwrite files you are currently working on.',
      nextSteps: 'Stash or commit your current changes before trying again.',
      rawStderr: stderr,
    };
  }

  // 3. Unmerged Files
  if (lowerErr.includes('you need to resolve your current index first') || lowerErr.includes('unmerged files')) {
    return {
      message: `Cannot ${action} with unresolved conflicts.`,
      reason: 'Your repository is currently in the middle of a conflict resolution.',
      nextSteps: 'Resolve all conflicts and commit, or abort the current operation (e.g., `git merge --abort`).',
      rawStderr: stderr,
    };
  }

  // 4. Detached HEAD
  if (lowerErr.includes('you are in \'detached head\' state')) {
    return {
      message: `Warning: Detached HEAD state.`,
      reason: 'You checked out a specific commit rather than a branch.',
      nextSteps: 'If you want to keep any new commits you create, create a new branch here.',
      rawStderr: stderr,
    };
  }
  
  // 5. Branch Already Exists
  if (lowerErr.includes('already exists')) {
    return {
      message: `Cannot create branch.`,
      reason: 'A branch with that name already exists.',
      nextSteps: 'Choose a different name or delete the existing branch first.',
      rawStderr: stderr,
    };
  }

  // Fallback for unknown errors
  return {
    message: `Git ${action} failed.`,
    reason: 'An unexpected error occurred during the Git operation.',
    nextSteps: 'Check the Git Tree Explorer output channel for more details.',
    rawStderr: stderr,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
