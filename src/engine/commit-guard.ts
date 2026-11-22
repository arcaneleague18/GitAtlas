import * as vscode from 'vscode';
import type { GitService } from '../services/git.service.js';
import { checkCancelled, cancellable } from '../ai/types.js';

/** One commit policy for both the graph and agent; never stages implicitly. */
export async function commitStagedWithGuard(git: GitService, message: string, date?: string, signal?: AbortSignal): Promise<boolean> {
  if (signal) checkCancelled(signal);
  const status = await git.getStatus();
  if (status.conflicted.length) throw new Error('Resolve and stage all conflicts before committing.');
  if (!status.staged.length) throw new Error('No staged files. Explicitly stage the intended files before committing.');
  const snapshot = await git.exec(['diff', '--cached', '--raw', '-z', '--no-abbrev']);
  const warnings = git.checkSensitiveFiles(status.staged.map(file => file.path));
  if (warnings.length) {
    const approval = vscode.window.showWarningMessage(
      'Git Atlas: Staged files may contain secrets or generated artifacts.',
      { modal: true, detail: warnings.map(warning => warning.path + ' — ' + warning.description).join('\n') },
      'Add to .gitignore', 'Continue Anyway'
    );
    const choice = signal ? await cancellable(approval, signal) : await approval;
    if (signal) checkCancelled(signal);
    if (choice === 'Add to .gitignore') {
      for (const warning of warnings) {
        if (signal) checkCancelled(signal);
        await git.addToGitignore(warning.path);
      }
      return false;
    }
    if (choice !== 'Continue Anyway') return false;
  }
  if (signal) checkCancelled(signal);
  if (snapshot !== await git.exec(['diff', '--cached', '--raw', '-z', '--no-abbrev'])) {
    throw new Error('The staged changes changed during approval. Review them again before committing.');
  }
  if (signal) checkCancelled(signal);
  await git.createCommit(message, date);
  return true;
}
