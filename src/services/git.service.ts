/**
 * Git Service — wraps the Git CLI with typed methods.
 *
 * Design decisions:
 * - Uses `child_process.execFile` (not `exec`) for security (no shell injection).
 * - Never returns raw strings to consumers — always parsed, typed results.
 * - Discovers git binary via VS Code's built-in git extension when available,
 *   falls back to `git` on PATH.
 * - All methods accept an optional `cwd` for multi-root workspace support.
 * - Parses `git log` with `--format` for structured, delimiter-based output.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import type {
  RawCommit,
  RawBranch,
  RawTag,
  RawStash,
  RawRemote,
  RawStatus,
  RawHead,
  FileChange,
  FileChangeStatus,
  RepositoryState,
  DiffFileStat,
} from '../engine/types.js';

const execFileAsync = promisify(execFile);

/** Delimiter used in git log format strings to separate fields. */
const FIELD_SEP = '\x1f'; // ASCII Unit Separator
/** Delimiter used in git log format strings to separate records. */
const RECORD_SEP = '\x1e'; // ASCII Record Separator

/** Maximum buffer size for git commands (50 MB). */
const MAX_BUFFER = 50 * 1024 * 1024;

export class GitService {
  private gitPath: string = 'git';
  private readonly workspaceRoot: string;
  private readonly outputChannel: vscode.OutputChannel;

  constructor(workspaceRoot: string, outputChannel: vscode.OutputChannel) {
    this.workspaceRoot = workspaceRoot;
    this.outputChannel = outputChannel;
  }

  /**
   * Initialize the service by discovering the git binary.
   * Uses VS Code's built-in git extension when available.
   */
  async initialize(): Promise<void> {
    try {
      const gitExtension = vscode.extensions.getExtension('vscode.git');
      if (gitExtension) {
        const git = gitExtension.isActive
          ? gitExtension.exports
          : await gitExtension.activate();
        const api = git.getAPI(1);
        if (api?.git?.path) {
          this.gitPath = api.git.path;
          return;
        }
      }
    } catch {
      // Fall back to PATH
    }

    // Verify git is available on PATH
    try {
      await this.exec(['--version']);
    } catch {
      throw new Error(
        'Git not found. Please install Git or ensure it is on your PATH.'
      );
    }
  }

  /**
   * Execute a raw git command and return stdout.
   */
  private async exec(
    args: string[],
    cwd?: string
  ): Promise<string> {
    const cmd = `git ${args.join(' ')}`;
    this.outputChannel.appendLine(`[GitService] > ${cmd}`);
    
    try {
      const { stdout } = await execFileAsync(this.gitPath, args, {
        cwd: cwd ?? this.workspaceRoot,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
      });
      if (stdout.trim().length > 0) {
        this.outputChannel.appendLine(stdout.trim());
      }
      return stdout;
    } catch (err: any) {
      if (err.stderr) {
        this.outputChannel.appendLine(`[GitService] ERROR: ${err.stderr.trim()}`);
      }
      throw err;
    }
  }

  /**
   * Check if the workspace is a git repository.
   */
  async isGitRepository(): Promise<boolean> {
    try {
      await this.exec(['rev-parse', '--is-inside-work-tree']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the repository root path.
   */
  async getRepositoryRoot(): Promise<string> {
    const root = await this.exec(['rev-parse', '--show-toplevel']);
    return root.trim();
  }

  /**
   * Get the current HEAD — branch name or detached hash.
   */
  async getHead(): Promise<RawHead> {
    try {
      // Try to get symbolic ref (branch name)
      const branch = (
        await this.exec(['symbolic-ref', '--short', 'HEAD'])
      ).trim();
      const hash = (await this.exec(['rev-parse', 'HEAD'])).trim();
      return { hash, branch, isDetached: false };
    } catch {
      // Detached HEAD
      try {
        const hash = (await this.exec(['rev-parse', 'HEAD'])).trim();
        return { hash, branch: null, isDetached: true };
      } catch {
        // Empty repository
        return { hash: '', branch: null, isDetached: false };
      }
    }
  }


  /**
   * Get commit log as parsed objects.
   *
   * @param maxCount Maximum number of commits to retrieve (default: 500).
   * @param includeReflog When true, also fetches commits only reachable via
   *   the reflog (orphaned commits) and merges them into the result.
   */
  async getLog(maxCount: number = 500, includeReflog: boolean = false): Promise<RawCommit[]> {
    const format = [
      '%H',   // hash
      '%h',   // short hash
      '%P',   // parent hashes
      '%an',  // author name
      '%ae',  // author email
      '%at',  // author timestamp (unix)
      '%s',   // subject
      '%D',   // ref names
    ].join(FIELD_SEP);

    let stdout: string;
    try {
      stdout = await this.exec([
        'log',
        `--max-count=${maxCount}`,
        `--format=${RECORD_SEP}${format}`,
        '--all',
        '--topo-order',
      ]);
    } catch {
      // No commits yet
      return [];
    }

    const records = stdout
      .split(RECORD_SEP)
      .map((r) => r.trim())
      .filter(Boolean);

    const commits = records.map((record) => {
      const fields = record.split(FIELD_SEP);
      return {
        hash: fields[0] ?? '',
        shortHash: fields[1] ?? '',
        parentHashes: (fields[2] ?? '').split(' ').filter(Boolean),
        author: fields[3] ?? '',
        authorEmail: fields[4] ?? '',
        timestamp: parseInt(fields[5] ?? '0', 10),
        message: fields[6] ?? '',
        refs: fields[7] ?? '',
      };
    });

    // If reflog is requested, find orphaned commits and merge them in
    if (includeReflog) {
      const knownHashes = new Set(commits.map((c) => c.hash));
      const reflogCommits = await this.getReflogCommits(maxCount, format);
      for (const rc of reflogCommits) {
        if (!knownHashes.has(rc.hash)) {
          commits.push(rc);
          knownHashes.add(rc.hash);
        }
      }
    }

    return commits;
  }

  /**
   * Fetch commits reachable only via the reflog.
   * Uses `git reflog` to get hashes, then `git log` to get full data
   * for any that aren't already in the normal `--all` output.
   */
  private async getReflogCommits(maxCount: number, format: string): Promise<RawCommit[]> {
    let reflogOutput: string;
    try {
      reflogOutput = await this.exec([
        'reflog',
        '--format=%H',
        `--max-count=${maxCount}`,
      ]);
    } catch {
      return [];
    }

    const reflogHashes = reflogOutput.trim().split('\n').filter(Boolean);
    if (reflogHashes.length === 0) return [];

    // Get full commit data for reflog-only hashes
    let stdout: string;
    try {
      stdout = await this.exec([
        'log',
        `--max-count=${maxCount}`,
        `--format=${RECORD_SEP}${format}`,
        '--no-walk',
        ...reflogHashes,
      ]);
    } catch {
      return [];
    }

    const records = stdout
      .split(RECORD_SEP)
      .map((r) => r.trim())
      .filter(Boolean);

    return records.map((record) => {
      const fields = record.split(FIELD_SEP);
      return {
        hash: fields[0] ?? '',
        shortHash: fields[1] ?? '',
        parentHashes: (fields[2] ?? '').split(' ').filter(Boolean),
        author: fields[3] ?? '',
        authorEmail: fields[4] ?? '',
        timestamp: parseInt(fields[5] ?? '0', 10),
        message: fields[6] ?? '',
        refs: fields[7] ?? '',
      };
    });
  }

  /**
   * Get all branches (local and remote).
   */
  async getBranches(): Promise<RawBranch[]> {
    let stdout: string;
    try {
      stdout = await this.exec([
        'branch',
        '-a',
        '--format',
        [
          '%(refname:short)',
          '%(HEAD)',
          '%(upstream:short)',
          '%(objectname:short)',
          '%(refname)'
        ].join(FIELD_SEP),
      ]);
    } catch {
      return [];
    }

    const lines = stdout.trim().split('\n').filter(Boolean);
    const branches: RawBranch[] = [];

    for (const line of lines) {
      const fields = line.split(FIELD_SEP);
      const name = fields[0]?.trim() ?? '';
      const isCurrent = fields[1]?.trim() === '*';
      const upstream = fields[2]?.trim() || null;
      const tipHash = fields[3]?.trim() ?? '';
      const fullRef = fields[4]?.trim() ?? '';
      
      // Ignore symbolic remote HEADs (e.g. refs/remotes/origin/HEAD)
      if (!name || name.startsWith('(') || fullRef.endsWith('/HEAD')) continue;
      const isRemote = name.includes('/');

      // Get ahead/behind count for branches with upstreams
      let aheadBehind: { ahead: number; behind: number } | null = null;
      if (upstream && !isRemote) {
        try {
          const abOutput = (
            await this.exec([
              'rev-list',
              '--left-right',
              '--count',
              `${name}...${upstream}`,
            ])
          ).trim();
          const [ahead, behind] = abOutput.split('\t').map(Number);
          aheadBehind = {
            ahead: ahead ?? 0,
            behind: behind ?? 0,
          };
        } catch {
          // Upstream may not exist
        }
      }

      branches.push({
        name,
        isRemote,
        isCurrent,
        upstream,
        tipHash,
        aheadBehind,
      });
    }

    return branches;
  }

  /**
   * Get working directory status.
   */
  async getStatus(): Promise<RawStatus> {
    let stdout: string;
    try {
      stdout = await this.exec([
        'status',
        '--porcelain=2',
        '--untracked-files=all',
      ]);
    } catch {
      return { modified: [], staged: [], untracked: [], conflicted: [] };
    }

    const modified: FileChange[] = [];
    const staged: FileChange[] = [];
    const untracked: string[] = [];
    const conflicted: FileChange[] = [];

    const lines = stdout.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      if (line.startsWith('?')) {
        // Untracked file
        untracked.push(line.slice(2));
      } else if (line.startsWith('1') || line.startsWith('2')) {
        // Changed entry
        const parts = line.split(' ');
        const xy = parts[1] ?? '..';
        const path = line.startsWith('2')
          ? line.split('\t')[1]?.split('\t')[0] ?? parts[parts.length - 1] ?? ''
          : parts[parts.length - 1] ?? '';

        const indexStatus = xy[0] ?? '.';
        const wtStatus = xy[1] ?? '.';

        if (indexStatus !== '.') {
          staged.push({
            path: path.trim(),
            status: parseFileStatus(indexStatus),
          });
        }

        if (wtStatus !== '.') {
          modified.push({
            path: path.trim(),
            status: parseFileStatus(wtStatus),
          });
        }
      } else if (line.startsWith('u ')) {
        // Unmerged entry (conflict)
        const parts = line.split(' ');
        const path = parts[parts.length - 1] ?? '';
        conflicted.push({
          path: path.trim(),
          status: 'conflicted',
        });
      }
    }

    return { modified, staged, untracked, conflicted };
  }

  /**
   * Get all stashes.
   */
  async getStashes(): Promise<RawStash[]> {
    let stdout: string;
    try {
      stdout = await this.exec([
        'stash',
        'list',
        `--format=${['%H', '%gd', '%gs', '%at'].join(FIELD_SEP)}`,
      ]);
    } catch {
      return [];
    }

    if (!stdout.trim()) {
      return [];
    }

    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line, idx) => {
        const fields = line.split(FIELD_SEP);
        return {
          index: idx,
          hash: fields[0] ?? '',
          message: fields[2] ?? `stash@{${idx}}`,
          timestamp: parseInt(fields[3] ?? '0', 10),
          parentHash: '',
        };
      });
  }

  /**
   * Get all tags.
   */
  async getTags(): Promise<RawTag[]> {
    let stdout: string;
    try {
      stdout = await this.exec([
        'tag',
        '-l',
        '--format',
        [
          '%(refname:short)',
          '%(objectname:short)',
          '%(contents:subject)',
          '%(taggername)',
          '%(creatordate:unix)',
        ].join(FIELD_SEP),
      ]);
    } catch {
      return [];
    }

    if (!stdout.trim()) {
      return [];
    }

    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const fields = line.split(FIELD_SEP);
        const dateStr = fields[4]?.trim();
        return {
          name: fields[0]?.trim() ?? '',
          targetHash: fields[1]?.trim() ?? '',
          message: fields[2]?.trim() || null,
          tagger: fields[3]?.trim() || null,
          date: dateStr ? parseInt(dateStr, 10) : null,
        };
      });
  }

  /**
   * Get all remotes.
   */
  async getRemotes(): Promise<RawRemote[]> {
    let stdout: string;
    try {
      stdout = await this.exec(['remote', '-v']);
    } catch {
      return [];
    }

    if (!stdout.trim()) {
      return [];
    }

    const remoteMap = new Map<string, RawRemote>();
    const lines = stdout.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)/);
      if (!match) continue;

      const [, name, url, type] = match;
      if (!name || !url) continue;

      const existing = remoteMap.get(name) ?? {
        name,
        fetchUrl: '',
        pushUrl: '',
      };

      if (type === 'fetch') {
        existing.fetchUrl = url;
      } else {
        existing.pushUrl = url;
      }

      remoteMap.set(name, existing);
    }

    return Array.from(remoteMap.values());
  }

  /**
   * Get the number of files changed in a commit.
   */
  async getCommitFileCount(hash: string): Promise<number> {
    try {
      const stdout = await this.exec([
        'diff-tree',
        '--no-commit-id',
        '--name-only',
        '-r',
        hash,
      ]);
      return stdout.trim().split('\n').filter(Boolean).length;
    } catch {
      return 0;
    }
  }

  /**
   * Detect the current repository state (merging, rebasing, etc.).
   */
  async getRepositoryState(): Promise<RepositoryState> {
    try {
      // Check for merge in progress
      try {
        await this.exec(['rev-parse', '--verify', 'MERGE_HEAD']);
        return 'merging';
      } catch { /* not merging */ }

      // Check for rebase in progress
      try {
        const rebaseDir = await this.exec([
          'rev-parse',
          '--git-path',
          'rebase-merge',
        ]);
        const { stat } = await import('fs/promises');
        await stat(rebaseDir.trim());
        return 'rebasing';
      } catch { /* not rebasing (merge) */ }

      try {
        const rebaseDir = await this.exec([
          'rev-parse',
          '--git-path',
          'rebase-apply',
        ]);
        const { stat } = await import('fs/promises');
        await stat(rebaseDir.trim());
        return 'rebasing';
      } catch { /* not rebasing (apply) */ }

      // Check for cherry-pick in progress
      try {
        await this.exec(['rev-parse', '--verify', 'CHERRY_PICK_HEAD']);
        return 'cherry-picking';
      } catch { /* not cherry-picking */ }

      // Check if working directory is clean
      const status = await this.getStatus();
      if (
        status.modified.length === 0 &&
        status.staged.length === 0 &&
        status.untracked.length === 0
      ) {
        return 'clean';
      }

      return 'dirty';
    } catch {
      return 'clean';
    }
  }

  /**
   * Get the diff statistics for a specific commit compared to its parent.
   */
  async getDiffStats(commitHash: string): Promise<DiffFileStat[]> {
    try {
      // --numstat outputs: insertions deletions path
      const output = await this.exec([
        'diff-tree',
        '--no-commit-id',
        '--numstat',
        '--root',
        '-r',
        commitHash,
      ]);

      const lines = output.split('\n').filter((l) => l.trim().length > 0);
      const stats: DiffFileStat[] = [];

      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 3) {
          const insStr = parts[0]!.trim();
          const delStr = parts[1]!.trim();
          const path = parts.slice(2).join('\t').trim();

          const isBinary = insStr === '-' || delStr === '-';
          stats.push({
            path,
            insertions: isBinary ? 0 : parseInt(insStr, 10) || 0,
            deletions: isBinary ? 0 : parseInt(delStr, 10) || 0,
            isBinary,
          });
        }
      }

      return stats;
    } catch {
      return [];
    }
  }

  // ── Execution Methods ───────────────────────────────────────────

  async checkout(ref: string): Promise<void> {
    await this.exec(['checkout', ref]);
  }

  async createBranch(name: string, ref?: string): Promise<void> {
    const args = ['branch', name];
    if (ref) {
      args.push(ref);
    }
    await this.exec(args);
  }

  async deleteBranch(name: string, force = false): Promise<void> {
    await this.exec(['branch', force ? '-D' : '-d', name]);
  }

  async merge(ref: string): Promise<void> {
    await this.exec(['merge', ref]);
  }

  async rebase(ref: string): Promise<void> {
    await this.exec(['rebase', ref]);
  }

  async cherryPick(hash: string): Promise<void> {
    await this.exec(['cherry-pick', hash]);
  }

  async reset(hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    await this.exec(['reset', `--${mode}`, hash]);
  }

  async revert(hash: string): Promise<void> {
    await this.exec(['revert', hash]);
  }

  async createTag(name: string, ref?: string, message?: string): Promise<void> {
    const args = ['tag'];
    if (message) {
      args.push('-a', name, '-m', message);
    } else {
      args.push(name);
    }
    if (ref) {
      args.push(ref);
    }
    await this.exec(args);
  }

  async deleteTag(name: string): Promise<void> {
    await this.exec(['tag', '-d', name]);
  }

  async push(branch?: string): Promise<void> {
    const args = ['push'];
    if (branch) {
      args.push('origin', branch);
    }
    await this.exec(args);
  }

  async fetch(remote?: string): Promise<void> {
    const args = ['fetch'];
    if (remote) {
      args.push(remote);
    }
    await this.exec(args);
  }

  async show(ref: string, relativePath: string): Promise<string> {
    const stdout = await this.exec(['show', `${ref}:${relativePath}`]);
    return stdout;
  }

  async createCommit(message: string): Promise<void> {
    const status = await this.getStatus();
    // If nothing is staged yet, stage everything before committing
    if (status.staged.length === 0) {
      await this.exec(['add', '-A']);
    }
    await this.exec(['commit', '-m', message]);
  }

  async stageFile(relativePath: string): Promise<void> {
    await this.exec(['add', relativePath]);
  }

  async unstageFile(relativePath: string): Promise<void> {
    try {
      await this.exec(['restore', '--staged', relativePath]);
    } catch {
      await this.exec(['reset', 'HEAD', '--', relativePath]);
    }
  }

  async stageAll(): Promise<void> {
    await this.exec(['add', '-A']);
  }

  async unstageAll(): Promise<void> {
    try {
      await this.exec(['restore', '--staged', '.']);
    } catch {
      await this.exec(['reset', 'HEAD']);
    }
  }

  async discardFile(relativePath: string): Promise<void> {
    try {
      await this.exec(['checkout', '--', relativePath]);
    } catch {
      await this.exec(['clean', '-f', relativePath]);
    }
  }

  async generateCommitMessage(): Promise<string> {
    const status = await this.getStatus();
    const hasStaged = status.staged.length > 0;
    const hasModified = status.modified.length > 0;
    const untracked = status.untracked;

    if (!hasStaged && !hasModified && untracked.length === 0) {
      return 'chore: commit changes';
    }

    let diff = '';
    try {
      if (hasStaged) {
        diff = await this.exec(['diff', '--cached']);
      } else {
        diff = await this.exec(['diff']);
      }
    } catch {
      // ignore
    }

    // Limit diff size to avoid token limits
    if (diff.length > 10000) {
      diff = diff.substring(0, 10000) + '\n... (diff truncated)';
    }

    const context = `Diff:\n${diff}\nUntracked files:\n${untracked.join('\n')}`;

    try {
      const models = await vscode.lm.selectChatModels();
      const model = models.find(m => m.vendor === 'copilot' && m.family === 'gpt-4o') || models[0];

      if (model) {
        const prompt = `You are an expert developer. Generate a concise, conventional commit message based on the following changes. Do NOT wrap the output in quotes or markdown blocks. Just return the commit message text. Use the format "type: description".

${context}`;

        const response = await model.sendRequest([
          vscode.LanguageModelChatMessage.User(prompt)
        ], {}, new vscode.CancellationTokenSource().token);

        let result = '';
        for await (const chunk of response.text) {
          result += chunk;
        }

        return result.trim().replace(/^['"`]+|['"`]+$/g, ''); // strip quotes
      }
    } catch (e) {
      console.error('Failed to generate commit message with LM:', e);
    }

    // Fallback logic
    const files = [
      ...status.staged.map((f) => f.path),
      ...status.modified.map((f) => f.path),
      ...status.untracked,
    ];

    const mainFile = files[0]!;
    const basename = mainFile.split(/[/\\]/).pop() || mainFile;

    let prefix = 'feat';
    if (mainFile.includes('css') || mainFile.includes('style')) prefix = 'style';
    else if (mainFile.includes('test') || mainFile.includes('spec')) prefix = 'test';
    else if (mainFile.includes('doc') || mainFile.endsWith('.md')) prefix = 'docs';
    else if (mainFile.includes('config') || mainFile.endsWith('.json')) prefix = 'chore';

    return `${prefix}: update ${basename}${files.length > 1 ? ` and ${files.length - 1} other file${files.length > 2 ? 's' : ''}` : ''}`;
  }

  async createStash(message?: string): Promise<void> {
    const args = ['stash', 'push', '--include-untracked'];
    if (message) {
      args.push('-m', message);
    }
    await this.exec(args);
  }

  /**
   * Reword a commit message — robust implementation covering ALL cases:
   *
   * Case 1 (HEAD, not pushed): git commit --amend --only -m "msg"
   * Case 2 (HEAD, already pushed): same as 1, then offer force-push
   * Case 3 (older commit): git rebase -i with temp-file-based editors
   * Case 5 (root/first commit): git rebase -i --root
   * Case 6 (merge commit): --rebase-merges preserves merge topology
   *
   * Key robustness features:
   * - Uses temp files for commit messages (handles any characters: $, ", ', `, newlines, Unicode)
   * - --autostash handles dirty working directories automatically
   * - --rebase-merges preserves merge commit structure
   * - --root handles first commit in repository
   * - --only flag on amend prevents accidentally staging files
   * - Cleans up temp files in finally block
   */
  async rewordCommitMessage(hash: string, newMessage: string, isHead: boolean): Promise<void> {
    if (isHead) {
      // Case 1 & 2: HEAD commit — simple amend
      // --only ensures we ONLY change the message, never accidentally include staged files
      await this.exec(['commit', '--amend', '--only', '-m', newMessage]);
    } else {
      // Case 3, 5, 6: Older / root / merge commits — interactive rebase with temp files
      await this.rewordViaRebase(hash, newMessage);
    }
  }

  /**
   * Reword a non-HEAD commit via interactive rebase.
   *
   * Uses temporary script files (.sh) as editors.
   * This approach is completely robust across Windows, Mac, and Linux because:
   * - Git on Windows uses MSYS2 bash internally, so .sh scripts work perfectly there.
   * - By using forward slashes for all paths, we avoid bash escape sequence hell.
   * - The commit message is safely read from a file, bypassing inline quote issues.
   */
  private async rewordViaRebase(hash: string, newMessage: string): Promise<void> {
    const shortHash = hash.substring(0, 7);

    const { join } = await import('path');
    const { writeFileSync, unlinkSync, existsSync, chmodSync } = await import('fs');
    const { tmpdir } = await import('os');

    const timestamp = Date.now();
    // Use .sh for everything — Git uses bash internally on all platforms
    const tempMsgFile = join(tmpdir(), `git-atlas-msg-${shortHash}-${timestamp}.txt`);
    const tempSeqScript = join(tmpdir(), `git-atlas-seq-${shortHash}-${timestamp}.sh`);
    const tempEditorScript = join(tmpdir(), `git-atlas-edit-${shortHash}-${timestamp}.sh`);

    const tempFiles = [tempMsgFile, tempSeqScript, tempEditorScript];

    // Helper to format paths for bash (convert \ to /)
    const toPosixPath = (p: string) => p.replace(/\\/g, '/');

    try {
      // Write the new commit message to a temp file
      writeFileSync(tempMsgFile, newMessage, 'utf-8');

      // Sequence editor .sh: sed replace pick→reword
      const seqSh = [
        '#!/bin/sh',
        `sed -i -E 's/^pick (${shortHash}[^ ]*)/reword \\1/' "$1"`,
      ].join('\n');
      writeFileSync(tempSeqScript, seqSh, 'utf-8');
      chmodSync(tempSeqScript, '755');

      // Editor .sh: copy temp message file
      const editorSh = [
        '#!/bin/sh',
        `cp '${toPosixPath(tempMsgFile)}' "$1"`,
      ].join('\n');
      writeFileSync(tempEditorScript, editorSh, 'utf-8');
      chmodSync(tempEditorScript, '755');

      // Determine target: parent commit, or --root if this is the first commit
      let targetCommit = `${hash}^`;
      try {
        await this.exec(['rev-parse', '--verify', `${hash}^`]);
      } catch {
        // No parent → this is the root commit (Case 5)
        targetCommit = '--root';
      }

      this.outputChannel.appendLine(
        `[GitService] > git rebase -i --autostash --rebase-merges ${targetCommit} (reword ${shortHash})`
      );

      // Invoke sh explicitly with posix paths
      const seqEditorCmd = `sh "${toPosixPath(tempSeqScript)}"`;
      const commitEditorCmd = `sh "${toPosixPath(tempEditorScript)}"`;

      await execFileAsync(
        this.gitPath,
        ['rebase', '-i', '--autostash', '--rebase-merges', targetCommit],
        {
          cwd: this.workspaceRoot,
          maxBuffer: MAX_BUFFER,
          windowsHide: true,
          env: {
            ...process.env,
            GIT_SEQUENCE_EDITOR: seqEditorCmd,
            GIT_EDITOR: commitEditorCmd,
          },
        }
      );
    } catch (err: any) {
      if (err.stderr) {
        this.outputChannel.appendLine(`[GitService] ERROR: ${err.stderr.trim()}`);
      }

      // If rebase failed mid-way, abort to leave repo in clean state
      try {
        await this.exec(['rebase', '--abort']);
        this.outputChannel.appendLine('[GitService] Rebase aborted after failure.');
      } catch {
        // Already clean or abort also failed — nothing we can do
      }

      throw err;
    } finally {
      // Always clean up ALL temp files
      for (const f of tempFiles) {
        try {
          if (existsSync(f)) {
            unlinkSync(f);
          }
        } catch {
          // Non-critical
        }
      }
    }
  }

  /**
   * Check if a commit has been pushed to any remote tracking branch.
   * Used to determine whether to offer force-push after rewording.
   */
  async isCommitPushed(hash: string): Promise<boolean> {
    try {
      // Check if this commit is an ancestor of any remote branch
      const stdout = await this.exec(['branch', '-r', '--contains', hash]);
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Force-push with lease — the safe way to update remote after history rewrite.
   * --force-with-lease ensures we don't overwrite others' work if the remote
   * has changed since our last fetch.
   */
  async forcePushWithLease(branch?: string): Promise<void> {
    const args = ['push', '--force-with-lease'];
    if (branch) {
      args.push('origin', branch);
    }
    await this.exec(args);
  }
}

/**
 * Parse a single-character git status code to a FileChangeStatus.
 */
function parseFileStatus(code: string): FileChangeStatus {
  switch (code) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    default:
      return 'modified';
  }
}
