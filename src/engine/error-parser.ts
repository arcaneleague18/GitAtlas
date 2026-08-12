/**
 * Error Parser — converts raw Git stderr into user-friendly explanations.
 */

import * as vscode from 'vscode';

export interface GitError {
  message: string;
  reason: string;
  nextSteps: string;
  rawStderr: string;
}

/**
 * Uses vscode.lm (GitHub Copilot or any available model) to generate a
 * plain-English explanation + suggested next steps for a raw git error.
 * Returns null if no model is available.
 */
export async function explainGitErrorWithAi(
  stderr: string,
  action: string
): Promise<{ explanation: string; nextSteps: string } | null> {
  try {
    let model: vscode.LanguageModelChat | undefined;

    const copilotModels = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
    model = copilotModels[0];

    if (!model) {
      const allModels = await vscode.lm.selectChatModels();
      model = allModels[0];
    }

    if (!model) return null;

    const prompt = `You are a Git expert assistant embedded in a VS Code extension called Git Atlas.
A user just tried to perform a Git "${action}" operation and it failed with the following error output:

\`\`\`
${stderr}
\`\`\`

In 2-3 sentences, explain in plain English:
1. WHY this error happened.
2. What the user should do next to fix it.

Be concise, friendly, and specific. Do not use bullet points, headers, or markdown formatting.
Reply ONLY with the explanation text.`;

    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const response = await model.sendRequest(messages, {});

    let fullText = '';
    for await (const chunk of response.stream) {
      if (chunk instanceof vscode.LanguageModelTextPart) {
        fullText += chunk.value;
      }
    }

    const text = fullText.trim();
    if (!text) return null;

    // Split at the first sentence boundary to separate "why" from "next steps"
    const sentenceEnd = text.search(/(?<=[.!?])\s+(?=[A-Z])/);
    if (sentenceEnd !== -1) {
      return {
        explanation: text.slice(0, sentenceEnd + 1).trim(),
        nextSteps: text.slice(sentenceEnd + 1).trim(),
      };
    }

    return { explanation: text, nextSteps: '' };
  } catch {
    return null;
  }
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
    reason: stderr ? stderr.split('\n')[0] : 'An unexpected error occurred during the Git operation.',
    nextSteps: 'Check the Git Atlas output channel for more details.',
    rawStderr: stderr,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
