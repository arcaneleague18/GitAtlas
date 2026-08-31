/**
 * Action Executor — The central controller for executing Git actions.
 *
 * Architecture Flow:
 * 1. Webview requests an action (e.g. switch, reset).
 * 2. ActionExecutor validates the request.
 * 3. Sends a preview payload to the Webview.
 * 4. Shows a VS Code native confirmation dialog (if dangerous).
 * 5. Executes the Git command via GitService.
 * 6. Handles errors via ErrorParser.
 * 7. Triggers a full state refresh.
 */

import * as vscode from 'vscode';
import { GitService } from '../services/git.service.js';
import { RepositoryStateEngine } from './state-engine.js';
import { parseGitError, explainGitErrorWithAi } from './error-parser.js';
import type { EdgeKind } from './types.js';

export class ActionExecutor {
  constructor(
    private readonly gitService: GitService,
    private readonly stateEngine: RepositoryStateEngine,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  /**
   * Main entry point called by GraphPanelProvider when webview requests an action.
   */
  async handleActionRequest(
    action: EdgeKind,
    nodeId: string,
    postMessage: (msg: any) => void,
    args?: any
  ): Promise<{ mergeConflicts: boolean }> {
    const graph = this.stateEngine.graph;
    if (!graph) return { mergeConflicts: false };

    const node = graph.nodes.get(nodeId);
    if (!node) {
      vscode.window.showErrorMessage(`Cannot execute ${action}: Node ${nodeId} not found.`);
      return { mergeConflicts: false };
    }

    try {
      // 1. Send Preview to Webview
      postMessage({
        type: 'preview-action',
        preview: { action, nodeId },
      });

      // 2. Validate & Confirm
      const confirmed = await this.confirmAction(action, node);
      if (!confirmed) {
        postMessage({ type: 'clear-preview' });
        return { mergeConflicts: false };
      }

      // 3. Execute
      let wasPushed = false;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Git: ${this.getVerb(action)}...`,
          cancellable: false,
        },
        async () => {
          if (action === 'delete-commit' || action === 'reword') {
            const hash = (node.data as any).hash || node.id;
            try {
              wasPushed = await this.gitService.isCommitPushed(hash);
            } catch {
              // ignore
            }
          }
          await this.executeCommand(action, node, args);
        }
      );

      // 4. Success Notification
      if ((action === 'delete-commit' || action === 'reword') && wasPushed && graph.currentBranch) {
        const actionLabel = action === 'reword' ? 'Commit message changed' : 'Commit deleted';
        const forcePush = 'Force Push (--force-with-lease)';
        const choice = await vscode.window.showWarningMessage(
          `Git Atlas: ${actionLabel}. This commit was already pushed to the remote. ` +
          `You need to force-push to update the remote branch "${graph.currentBranch}".`,
          { modal: false },
          forcePush
        );
        if (choice === forcePush) {
          try {
            await this.gitService.forcePushWithLease(graph.currentBranch);
            vscode.window.showInformationMessage(
              `Git Atlas: Force-pushed "${graph.currentBranch}" to remote with --force-with-lease.`
            );
          } catch (pushErr: any) {
            const pushErrMsg = pushErr.stderr?.trim() || pushErr.message || 'Unknown error';
            vscode.window.showErrorMessage(
              `Git Atlas: Force-push failed — ${pushErrMsg}`
            );
          }
        }
      } else {
        vscode.window.showInformationMessage(`Successfully completed ${action}.`);
      }
    } catch (err: any) {
      // 5. Error Handling — show static error immediately, then enhance with AI
      const stderr = err.stderr || err.message || 'Unknown error';
      const parsedError = parseGitError(stderr, action);

      this.outputChannel.appendLine(`\n[Git Atlas] ${action} failed at ${new Date().toISOString()}`);
      this.outputChannel.appendLine(`Stderr: ${stderr}`);

      const viewDetailsBtn = 'View Details';

      // Fire the AI explanation in the background without blocking
      void (async () => {
        const aiResult = await explainGitErrorWithAi(stderr, action);

        if (aiResult) {
          this.outputChannel.appendLine(`\n[AI Explanation]\n${aiResult.explanation}`);
          if (aiResult.nextSteps) {
            this.outputChannel.appendLine(`[Suggested next steps]\n${aiResult.nextSteps}`);
          }

          const fullMsg = aiResult.nextSteps
            ? `${aiResult.explanation} ${aiResult.nextSteps}`
            : aiResult.explanation;

          const aiChoice = await vscode.window.showErrorMessage(
            `⚡ Git Atlas — ${action} failed: ${fullMsg}`,
            viewDetailsBtn
          );
          if (aiChoice === viewDetailsBtn) {
            this.outputChannel.show();
          }
        } else {
          // Fallback to static parser message
          const choice = await vscode.window.showErrorMessage(
            `Git Atlas — ${parsedError.message} ${parsedError.reason}\n${parsedError.nextSteps}`,
            viewDetailsBtn
          );
          if (choice === viewDetailsBtn) {
            this.outputChannel.show();
          }
        }
      })();
    } finally {
      // 6. Cleanup & Refresh
      postMessage({ type: 'clear-preview' });
      await this.stateEngine.buildGraph();
    }

    // 7. After merge, check if conflicts exist
    if (action === 'merge') {
      const updatedGraph = this.stateEngine.graph;
      if (updatedGraph && updatedGraph.state === 'merging') {
        const wdNode = updatedGraph.nodes.get('working-directory');
        if (wdNode && wdNode.data.kind === 'working-directory' && wdNode.data.conflicted.length > 0) {
          return { mergeConflicts: true };
        }
      }
    }

    return { mergeConflicts: false };
  }

  /**
   * Prompts the user for confirmation if the action is dangerous,
   * or for input if the action requires it (branch name, tag name).
   *
   * Non-destructive actions are confirmed in the webview's ActionPreviewPanel,
   * so they pass through here without an extra dialog.
   */
  private async confirmAction(action: EdgeKind, node: any): Promise<boolean> {
    // Destructive actions get a native VS Code warning as a second safety net
    if (action === 'reset' || action === 'delete-branch' || action === 'delete-commit') {
      const confirmText = action === 'reset' ? 'Reset (Hard)' : action === 'delete-commit' ? 'Delete Commit' : 'Delete Branch';
      const choice = await vscode.window.showWarningMessage(
        `Are you sure you want to perform a ${action} on ${node.label}? This action cannot be easily undone.`,
        { modal: true },
        confirmText
      );
      return choice === confirmText;
    }

    // Actions that require text input
    if (action === 'branch') {
      const name = await vscode.window.showInputBox({
        prompt: 'Enter new branch name',
        placeHolder: 'feature/my-new-branch',
      });
      if (!name) return false;
      node._tempBranchName = name;
      return true;
    }

    if (action === 'create-tag') {
      const name = await vscode.window.showInputBox({
        prompt: 'Enter tag name',
        placeHolder: 'v1.0.0',
      });
      if (!name) return false;
      const message = await vscode.window.showInputBox({
        prompt: 'Enter tag message (leave empty for lightweight tag)',
        placeHolder: 'Release version 1.0.0',
      });
      node._tempTagName = name;
      node._tempTagMessage = message || undefined;
      return true;
    }

    if (action === 'commit') {
      const message = await vscode.window.showInputBox({
        prompt: 'Enter commit message',
        placeHolder: 'feat: add awesome feature',
        validateInput: (value) => (value.trim() ? null : 'Commit message cannot be empty'),
      });
      if (!message || !message.trim()) return false;
      node._tempCommitMessage = message.trim();
      return true;
    }

    if (action === 'stash') {
      const message = await vscode.window.showInputBox({
        prompt: 'Enter stash message (optional)',
        placeHolder: 'Work in progress',
      });
      node._tempStashMessage = message || undefined;
      return true;
    }

    if (action === 'reword') {
      const newMessage = await vscode.window.showInputBox({
        prompt: 'Enter new commit message',
        placeHolder: 'New commit message',
        value: node.data?.message || '',
        validateInput: (value) => (value.trim() ? null : 'Commit message cannot be empty'),
      });
      if (!newMessage || !newMessage.trim()) return false;
      node._tempRewordMessage = newMessage.trim();
      return true;
    }

    // All other actions are already confirmed by the webview preview panel
    return true;
  }

  /**
   * Maps the UI action to the underlying GitService method.
   */
  private async executeCommand(action: EdgeKind, node: any, args?: any): Promise<void> {
    const hash = node.data.hash || node.id;
    const branchName = node.label;

    switch (action) {
      case 'switch':
        // For remote branches, switch to the remote branch itself (which results in a detached HEAD)
        // For commits, it also goes into detached HEAD.
        await this.gitService.switchRef(node.kind === 'branch' || node.kind === 'remote-branch' ? branchName : hash);
        break;
      case 'branch':
        await this.gitService.createBranch(node._tempBranchName, hash);
        break;
      case 'delete-branch':
        if (node.kind === 'tag') {
          await this.gitService.deleteTag(branchName);
        } else {
          await this.gitService.deleteBranch(branchName, true);
        }
        break;
      case 'delete-remote-branch': {
        const [remote, ...rest] = branchName.split('/');
        const remoteBranch = rest.join('/');
        await this.gitService.deleteRemoteBranch(remote!, remoteBranch);
        break;
      }
      case 'merge': {
        const ref = node.kind === 'branch' || node.kind === 'remote-branch' ? branchName : hash;
        const mergeStrategy = args?.mergeStrategy as 'ff' | 'no-ff' | 'ff-only' | undefined;
        const mergeMessage = args?.mergeMessage as string | undefined;
        await this.gitService.merge(ref, mergeStrategy, mergeMessage);
        break;
      }
      case 'rebase':
        await this.gitService.rebase(node.kind === 'branch' || node.kind === 'remote-branch' ? branchName : hash);
        break;
      case 'cherry-pick':
        await this.gitService.cherryPick(hash);
        break;
      case 'revert':
        await this.gitService.revert(hash);
        break;
      case 'reset':
        await this.gitService.reset(hash, 'hard');
        break;
      case 'reset-soft':
        await this.gitService.reset(hash, 'soft');
        break;
      case 'reset-mixed':
        await this.gitService.reset(hash, 'mixed');
        break;
      case 'create-tag':
        await this.gitService.createTag(node._tempTagName, hash, node._tempTagMessage);
        break;
      case 'commit':
        await this.gitService.createCommit(node._tempCommitMessage);
        break;
      case 'stash':
        await this.gitService.createStash(node._tempStashMessage);
        break;
      case 'apply-stash':
        await this.gitService.applyStash(node.data.index);
        break;
      case 'pop-stash':
        await this.gitService.popStash(node.data.index);
        break;
      case 'stash-drop':
        await this.gitService.dropStash(node.data.index);
        break;
      case 'push':
        await this.gitService.push(node.kind === 'branch' ? branchName : undefined, args?.pushMode);
        break;
      case 'fetch':
        await this.gitService.fetch();
        break;
      case 'delete-commit':
        await this.gitService.deleteCommit(hash);
        break;
      case 'reword': {
        const isHead = hash === this.stateEngine.graph?.headHash;
        await this.gitService.rewordCommitMessage(hash, node._tempRewordMessage, isHead);
        break;
      }
      default:
        throw new Error(`Action ${action} is not yet implemented.`);
    }
  }

  private getVerb(action: EdgeKind): string {
    const verbs: Record<string, string> = {
      switch: 'Switching',
      branch: 'Creating branch',
      'delete-branch': 'Deleting branch',
      'delete-commit': 'Deleting commit',
      'delete-remote-branch': 'Deleting remote branch',
      merge: 'Merging',
      rebase: 'Rebasing',
      'cherry-pick': 'Cherry-picking',
      revert: 'Reverting',
      reset: 'Resetting',
      'reset-soft': 'Soft resetting',
      'reset-mixed': 'Mixed resetting',
      'create-tag': 'Creating tag',
      commit: 'Committing',
      stash: 'Stashing',
      'apply-stash': 'Applying stash',
      'pop-stash': 'Popping stash',
      'stash-drop': 'Dropping stash',
      push: 'Pushing',
      pull: 'Pulling',
      fetch: 'Fetching',
      reword: 'Rewording commit',
    };
    return verbs[action] || 'Executing';
  }
}
