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
import * as fs from 'fs';
import * as path from 'path';
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
  PushStatusResult,
  RebaseProgress,
  RebaseCommitItem,
} from '../engine/types.js';

const execFileAsync = promisify(execFile);

/** Delimiter used in git log format strings to separate fields. */
const FIELD_SEP = '\x1f'; // ASCII Unit Separator
/** Delimiter used in git log format strings to separate records. */
const RECORD_SEP = '\x1e'; // ASCII Record Separator

/** Maximum buffer size for git commands (50 MB). */
const MAX_BUFFER = 50 * 1024 * 1024;

/**
 * Patterns for files/folders that should typically be in .gitignore.
 * Each entry has a pattern (matched against the file path) and a description.
 */
const SENSITIVE_PATTERNS: { pattern: RegExp; description: string }[] = [
  // Environment / secrets
  { pattern: /(\/|^)\.env(\..*)?$/i, description: 'Environment variables (may contain secrets)' },
  { pattern: /(\/|^)\.env\.local$/i, description: 'Local environment variables' },
  { pattern: /(\/|^)secrets?\.(json|ya?ml|toml|ini|cfg)$/i, description: 'Secrets configuration file' },
  { pattern: /(\/|^)credentials?\.(json|ya?ml|toml|ini|cfg)$/i, description: 'Credentials file' },
  { pattern: /(\/|^)\.secret$/i, description: 'Secret file' },
  { pattern: /\.(pem|key|p12|pfx|jks|keystore)$/i, description: 'Private key / certificate' },
  { pattern: /(\/|^)id_rsa/i, description: 'SSH private key' },
  { pattern: /(\/|^)\.aws\//i, description: 'AWS credentials directory' },
  { pattern: /(\/|^)\.gcp\//i, description: 'GCP credentials directory' },
  // Config files that often contain secrets
  { pattern: /(\/|^)firebase[\w-]*config\.(json|js|ts)$/i, description: 'Firebase configuration (may contain API keys)' },
  { pattern: /(\/|^)serviceAccount(Key)?\.(json)$/i, description: 'Service account key' },
  // Build / cache / logs
  { pattern: /(\/|^)__pycache__\//i, description: 'Python bytecode cache' },
  { pattern: /(\/|^)\.pytest_cache\//i, description: 'Pytest cache' },
  { pattern: /(\/|^)node_modules\//i, description: 'Node.js dependencies' },
  { pattern: /(\/|^)\.next\//i, description: 'Next.js build output' },
  { pattern: /(\/|^)dist\//i, description: 'Build output' },
  { pattern: /(\/|^)build\//i, description: 'Build output' },
  { pattern: /(\/|^)logs?\//i, description: 'Log files directory' },
  { pattern: /\.log$/i, description: 'Log file' },
  // IDE / OS
  { pattern: /(\/|^)\.DS_Store$/i, description: 'macOS metadata' },
  { pattern: /(\/|^)Thumbs\.db$/i, description: 'Windows thumbnail cache' },
  { pattern: /(\/|^)\.idea\//i, description: 'JetBrains IDE config' },
];

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
  public async exec(
    args: string[],
    cwd?: string,
    extraEnv?: Record<string, string>,
    timeoutMs?: number
  ): Promise<string> {
    const cmd = `git ${args.join(' ')}`;
    this.outputChannel.appendLine(`[GitService] > ${cmd}`);
    
    try {
      const { stdout } = await execFileAsync(this.gitPath, args, {
        cwd: cwd ?? this.workspaceRoot,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        timeout: timeoutMs,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...extraEnv },
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
   * Initialize a new git repository in the workspace root.
   */
  async initRepository(): Promise<void> {
    await this.exec(['init']);
    this.outputChannel.appendLine('[GitService] Initialized new git repository.');
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
        '--exclude=refs/stash',
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
      const reflogCommits = await this.getReflogCommits(maxCount, format, knownHashes);
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
   *
   * @param knownHashes Hashes already in the main log — skip these to avoid
   *   redundant git queries.
   */
  private async getReflogCommits(
    maxCount: number,
    format: string,
    knownHashes: Set<string>
  ): Promise<RawCommit[]> {
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

    // Deduplicate and filter out hashes already in the main log
    const allHashes = reflogOutput.trim().split('\n').filter(Boolean);
    const uniqueNewHashes: string[] = [];
    const seen = new Set<string>();
    for (const h of allHashes) {
      if (!seen.has(h) && !knownHashes.has(h)) {
        seen.add(h);
        uniqueNewHashes.push(h);
      }
    }
    if (uniqueNewHashes.length === 0) return [];

    // Batch hashes to avoid exceeding OS command-line argument limits
    // (Windows ~32K chars; each hash is 40 chars + space = ~41 chars)
    const BATCH_SIZE = 100;
    const results: RawCommit[] = [];

    for (let i = 0; i < uniqueNewHashes.length; i += BATCH_SIZE) {
      const batch = uniqueNewHashes.slice(i, i + BATCH_SIZE);
      let stdout: string;
      try {
        stdout = await this.exec([
          'log',
          `--max-count=${batch.length}`,
          `--format=${RECORD_SEP}${format}`,
          '--no-walk',
          ...batch,
        ]);
      } catch {
        continue; // Skip failed batches (some hashes may have been gc'd)
      }

      const records = stdout
        .split(RECORD_SEP)
        .map((r) => r.trim())
        .filter(Boolean);

      for (const record of records) {
        const fields = record.split(FIELD_SEP);
        results.push({
          hash: fields[0] ?? '',
          shortHash: fields[1] ?? '',
          parentHashes: (fields[2] ?? '').split(' ').filter(Boolean),
          author: fields[3] ?? '',
          authorEmail: fields[4] ?? '',
          timestamp: parseInt(fields[5] ?? '0', 10),
          message: fields[6] ?? '',
          refs: fields[7] ?? '',
        });
      }
    }

    return results;
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
      const isRemote = fullRef.startsWith('refs/remotes/');

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
        `--format=${['%H', '%gd', '%gs', '%at', '%P'].join(FIELD_SEP)}`,
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
          parentHash: (fields[4] ?? '').split(' ')[0] ?? '',
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
   * Extract co-authors from a commit's body (the `Co-authored-by:` trailers).
   * Returns an empty array when there are none.
   */
  async getCoAuthors(commitHash: string): Promise<{ name: string; email: string }[]> {
    try {
      const body = await this.exec([
        'log',
        '-1',
        '--format=%b',
        commitHash,
      ]);

      const coAuthors: { name: string; email: string }[] = [];
      const regex = /Co-authored-by:\s*(.+?)\s*<([^>]+)>/gi;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(body)) !== null) {
        coAuthors.push({ name: match[1]!.trim(), email: match[2]!.trim() });
      }
      return coAuthors;
    } catch {
      return [];
    }
  }

  /**
   * Get the diff statistics for a specific commit compared to its parent.
   */
  async getDiffStats(commitHash: string): Promise<DiffFileStat[]> {
    try {
      // --numstat outputs: insertions deletions path
      // -m is needed for merge commits (which have multiple parents);
      // without it, diff-tree silently produces no output for merges.
      // --first-parent diffs against the first parent only (the branch
      // being merged *into*), which is the most intuitive view.
      const output = await this.exec([
        'diff-tree',
        '--no-commit-id',
        '--numstat',
        '--root',
        '-m',
        '--first-parent',
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

  async switchRef(ref: string): Promise<void> {
    // Try git switch (works for local branches)
    try {
      await this.exec(['switch', ref]);
    } catch {
      // Fallback: detached HEAD for remote branches, commits, tags
      await this.exec(['switch', '--detach', ref]);
    }
  }

  async createBranch(name: string, ref?: string): Promise<void> {
    const args = ['branch', name];
    if (ref) {
      args.push(ref);
    }
    await this.exec(args);
  }

  /**
   * Create a new local branch tracking a remote branch.
   * If shouldSwitch is true, switches to the newly created tracking branch.
   */
  async createTrackingBranch(localBranch: string, remoteBranch: string, shouldSwitch: boolean = true): Promise<void> {
    if (shouldSwitch) {
      try {
        await this.exec(['switch', '-c', localBranch, '--track', remoteBranch]);
      } catch {
        await this.exec(['checkout', '-b', localBranch, '--track', remoteBranch]);
      }
    } else {
      await this.exec(['branch', '--track', localBranch, remoteBranch]);
    }
  }

  async deleteBranch(name: string, force = false): Promise<void> {
    await this.exec(['branch', force ? '-D' : '-d', name]);
  }

  async deleteRemoteBranch(remote: string, branch: string): Promise<void> {
    await this.exec(['push', remote, '--delete', branch]);
  }

  async merge(ref: string, strategy?: 'ff' | 'no-ff' | 'ff-only', message?: string): Promise<void> {
    const args = ['merge'];
    if (strategy === 'no-ff') {
      args.push('--no-ff');
    } else if (strategy === 'ff-only') {
      args.push('--ff-only');
    }
    // Default ('ff') uses git's default behavior (fast-forward when possible)
    if (message?.trim()) {
      args.push('-m', message.trim());
    }
    args.push(ref);
    await this.exec(args);
  }

  /**
   * Check if a ref can be cleanly merged or rebased into/onto the current branch.
   * Uses `git merge-tree --write-tree` (Git 2.38+) for an in-memory merge check.
   * Falls back to `git merge-base` diff check for older Git versions.
   */
  async checkMergeability(ref: string, action: 'merge' | 'rebase' = 'merge'): Promise<{
    canMerge: boolean;
    status: 'clean' | 'conflicts' | 'up-to-date' | 'fast-forward' | 'error';
    conflictFiles: string[];
    aheadBehind: { ahead: number; behind: number };
    message: string;
  }> {
    try {
      // First check ahead/behind counts
      let ahead = 0, behind = 0;
      try {
        const revList = await this.exec(['rev-list', '--left-right', '--count', `HEAD...${ref}`]);
        const parts = revList.trim().split(/\s+/);
        ahead = parseInt(parts[0] ?? '0', 10) || 0;
        behind = parseInt(parts[1] ?? '0', 10) || 0;
      } catch { /* ignore */ }

      // Check rebase-specific statuses
      if (action === 'rebase') {
        // In rebase: if behind === 0, ref is an ancestor of HEAD (already rebased/based on ref)
        if (behind === 0) {
          return {
            canMerge: true,
            status: 'up-to-date',
            conflictFiles: [],
            aheadBehind: { ahead, behind },
            message: 'Current branch is already based on this ref. Nothing to rebase.',
          };
        }

        // If ahead === 0, HEAD is an ancestor of ref (fast-forward rebase)
        if (ahead === 0) {
          return {
            canMerge: true,
            status: 'fast-forward',
            conflictFiles: [],
            aheadBehind: { ahead, behind },
            message: `Fast-forward rebase possible. Current branch will advance by ${behind} commit${behind !== 1 ? 's' : ''}.`,
          };
        }
      } else {
        // Standard merge: Already up to date (nothing to merge)
        if (behind === 0) {
          return {
            canMerge: true,
            status: 'up-to-date',
            conflictFiles: [],
            aheadBehind: { ahead, behind },
            message: 'Already up to date. Nothing to merge.',
          };
        }

        // Check if fast-forward is possible
        try {
          await this.exec(['merge-base', '--is-ancestor', 'HEAD', ref]);
          return {
            canMerge: true,
            status: 'fast-forward',
            conflictFiles: [],
            aheadBehind: { ahead, behind },
            message: `Fast-forward merge possible. ${behind} commit${behind !== 1 ? 's' : ''} will be added.`,
          };
        } catch { /* not a fast-forward — need to try merge */ }
      }

      // Try in-memory merge with merge-tree (Git 2.38+)
      try {
        await this.exec(['merge-tree', '--write-tree', 'HEAD', ref]);
        // Exit code 0 = clean merge
        return {
          canMerge: true,
          status: 'clean',
          conflictFiles: [],
          aheadBehind: { ahead, behind },
          message: action === 'rebase'
            ? `Able to rebase cleanly. ${ahead} commit${ahead !== 1 ? 's' : ''} will be replayed.`
            : `Able to merge. These branches can be automatically merged.`,
        };
      } catch (err: any) {
        const stderr = (err.stderr || '').toString();
        const stdout = (err.stdout || '').toString();
        const combined = stdout + '\n' + stderr;

        // merge-tree exits with code 1 if there are conflicts
        // Parse conflicting files from CONFLICT lines in stdout
        const conflictFiles: string[] = [];
        const lines = combined.split('\n');
        for (const line of lines) {
          // Pattern: "CONFLICT (content): Merge conflict in <filepath>"
          const mergeConflict = line.match(/CONFLICT\s+\([^)]+\):\s+Merge conflict in\s+(.+)/i);
          if (mergeConflict && mergeConflict[1]) {
            conflictFiles.push(mergeConflict[1].trim());
            continue;
          }
          // Pattern: "CONFLICT (modify/delete): <filepath> deleted in ..."
          const modifyDelete = line.match(/CONFLICT\s+\([^)]+\):\s+([^\s]+)\s+/i);
          if (modifyDelete && modifyDelete[1]) {
            conflictFiles.push(modifyDelete[1].trim());
            continue;
          }
          // Pattern: "CONFLICT (add/add): Merge conflict in <filepath>"
          const addAdd = line.match(/CONFLICT\s+\([^)]+\):\s+.*in\s+(\S+)/i);
          if (addAdd && addAdd[1] && !conflictFiles.includes(addAdd[1].trim())) {
            conflictFiles.push(addAdd[1].trim());
            continue;
          }
        }

        if (conflictFiles.length > 0 || combined.includes('CONFLICT')) {
          const verb = action === 'rebase' ? 'rebase' : 'merge';
          return {
            canMerge: false,
            status: 'conflicts',
            conflictFiles,
            aheadBehind: { ahead, behind },
            message: conflictFiles.length > 0
              ? `Cannot ${verb} automatically. ${conflictFiles.length} file${conflictFiles.length !== 1 ? 's have' : ' has'} conflicts.`
              : `Cannot ${verb} automatically. There are conflicts.`,
          };
        }

        // merge-tree not available, fall back to optimistic
        return {
          canMerge: true,
          status: 'clean',
          conflictFiles: [],
          aheadBehind: { ahead, behind },
          message: `${action === 'rebase' ? 'Rebase' : 'Merge'} check completed. Conflicts may still occur.`,
        };
      }
    } catch (err: any) {
      return {
        canMerge: false,
        status: 'error',
        conflictFiles: [],
        aheadBehind: { ahead: 0, behind: 0 },
        message: `Could not check ${action === 'rebase' ? 'rebase' : 'merge'} status: ${err.message || 'Unknown error'}`,
      };
    }
  }

  /**
   * Check whether the remote repository has been updated before pushing,
   * determining if a push would succeed, be rejected, or cause conflicts.
   */
  async checkPushStatus(branchName?: string): Promise<PushStatusResult> {
    try {
      let branch = branchName?.trim();
      if (!branch) {
        const head = await this.getHead();
        branch = head.branch ?? undefined;
      }

      if (!branch) {
        return {
          isRemoteUpdated: false,
          status: 'error',
          aheadBehind: { ahead: 0, behind: 0 },
          conflictFiles: [],
          hasConflicts: false,
          message: 'Cannot check remote status: HEAD is detached or no branch is selected.',
        };
      }

      // Check configured remotes
      let remotes: string[] = [];
      try {
        const remotesOutput = (await this.exec(['remote'])).trim();
        remotes = remotesOutput.split(/\s+/).filter(Boolean);
      } catch {
        // ignore
      }

      if (remotes.length === 0) {
        return {
          isRemoteUpdated: false,
          status: 'no-remote',
          aheadBehind: { ahead: 0, behind: 0 },
          conflictFiles: [],
          hasConflicts: false,
          message: 'No remote repository configured.',
        };
      }

      // 1. Resolve upstream or remote branch
      let remote = '';
      let remoteBranch = '';
      let upstreamRef = '';

      try {
        upstreamRef = (await this.exec(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`])).trim();
        const slashIdx = upstreamRef.indexOf('/');
        if (slashIdx > 0) {
          remote = upstreamRef.substring(0, slashIdx);
          remoteBranch = upstreamRef.substring(slashIdx + 1);
        }
      } catch {
        // No upstream configured for this branch
      }

      if (!remote) {
        // Default to origin if available, or first configured remote
        remote = remotes.includes('origin') ? 'origin' : remotes[0];
        remoteBranch = branch;
        upstreamRef = `${remote}/${remoteBranch}`;

        // Check if branch exists on remote
        try {
          const lsOut = (await this.exec(
            ['ls-remote', '--heads', remote, remoteBranch],
            undefined,
            { GIT_TERMINAL_PROMPT: '0' },
            7000
          )).trim();

          if (!lsOut) {
            // Branch does not exist on remote yet (new branch)
            return {
              isRemoteUpdated: false,
              status: 'new-branch',
              aheadBehind: { ahead: 0, behind: 0 },
              conflictFiles: [],
              hasConflicts: false,
              message: `New branch. Push will publish "${branch}" to "${remote}".`,
              remoteBranch: upstreamRef,
            };
          }
        } catch {
          // ls-remote failed (offline or network error)
          return {
            isRemoteUpdated: false,
            status: 'unreachable',
            aheadBehind: { ahead: 0, behind: 0 },
            conflictFiles: [],
            hasConflicts: false,
            message: 'Could not reach remote repository (offline or remote unreachable).',
            remoteBranch: upstreamRef,
          };
        }
      }

      // 2. Fetch the latest remote state for this branch
      let fetchSuccess = false;
      try {
        await this.exec(
          ['fetch', remote, `+refs/heads/${remoteBranch}:refs/remotes/${remote}/${remoteBranch}`],
          undefined,
          { GIT_TERMINAL_PROMPT: '0' },
          8000
        );
        fetchSuccess = true;
      } catch {
        try {
          await this.exec(
            ['fetch', remote],
            undefined,
            { GIT_TERMINAL_PROMPT: '0' },
            8000
          );
          fetchSuccess = true;
        } catch {
          fetchSuccess = false;
        }
      }

      // 3. Verify remote tracking ref exists
      try {
        await this.exec(['rev-parse', '--verify', upstreamRef]);
      } catch {
        return {
          isRemoteUpdated: false,
          status: fetchSuccess ? 'new-branch' : 'unreachable',
          aheadBehind: { ahead: 0, behind: 0 },
          conflictFiles: [],
          hasConflicts: false,
          message: fetchSuccess
            ? `New branch. Ready to publish "${branch}" to "${remote}".`
            : 'Could not reach remote repository (offline or remote unreachable).',
          remoteBranch: upstreamRef,
        };
      }

      // 4. Calculate ahead/behind count
      let ahead = 0;
      let behind = 0;
      try {
        const revList = await this.exec(['rev-list', '--left-right', '--count', `${branch}...${upstreamRef}`]);
        const parts = revList.trim().split(/\s+/);
        ahead = parseInt(parts[0] ?? '0', 10) || 0;
        behind = parseInt(parts[1] ?? '0', 10) || 0;
      } catch (revErr: any) {
        return {
          isRemoteUpdated: false,
          status: 'error',
          aheadBehind: { ahead: 0, behind: 0 },
          conflictFiles: [],
          hasConflicts: false,
          message: `Could not compare branch with remote: ${revErr.message || 'Unknown error'}`,
          remoteBranch: upstreamRef,
        };
      }

      // 5. Evaluate state based on ahead/behind counts
      if (behind === 0 && ahead === 0) {
        return {
          isRemoteUpdated: false,
          status: 'up-to-date',
          aheadBehind: { ahead: 0, behind: 0 },
          conflictFiles: [],
          hasConflicts: false,
          message: fetchSuccess
            ? 'Remote repository is up to date with local branch. Nothing to push.'
            : 'Up to date based on local tracking branch (remote unreachable).',
          remoteBranch: upstreamRef,
        };
      }

      if (behind === 0 && ahead > 0) {
        return {
          isRemoteUpdated: false,
          status: 'up-to-date',
          aheadBehind: { ahead, behind: 0 },
          conflictFiles: [],
          hasConflicts: false,
          message: fetchSuccess
            ? `Remote is up to date. Ready to push ${ahead} commit${ahead !== 1 ? 's' : ''}.`
            : `Ready to push ${ahead} commit${ahead !== 1 ? 's' : ''} (based on local tracking ref).`,
          remoteBranch: upstreamRef,
        };
      }

      // Remote has new commits! behind > 0
      if (ahead === 0) {
        return {
          isRemoteUpdated: true,
          status: 'behind',
          aheadBehind: { ahead: 0, behind },
          conflictFiles: [],
          hasConflicts: false,
          message: `Remote repository has been updated (${behind} commit${behind !== 1 ? 's' : ''} behind). Pull latest changes before pushing.`,
          remoteBranch: upstreamRef,
        };
      }

      // Diverged: ahead > 0 && behind > 0. Check for merge conflicts with merge-tree
      const conflictFiles: string[] = [];
      let hasConflicts = false;

      try {
        await this.exec(['merge-tree', '--write-tree', branch, upstreamRef]);
        hasConflicts = false;
      } catch (err: any) {
        const combined = ((err.stdout || '') + '\n' + (err.stderr || '')).toString();
        const lines = combined.split('\n');
        for (const line of lines) {
          const m1 = line.match(/CONFLICT\s+\([^)]+\):\s+Merge conflict in\s+(.+)/i);
          if (m1 && m1[1]) {
            conflictFiles.push(m1[1].trim());
            continue;
          }
          const m2 = line.match(/CONFLICT\s+\([^)]+\):\s+([^\s]+)\s+/i);
          if (m2 && m2[1]) {
            conflictFiles.push(m2[1].trim());
            continue;
          }
          const m3 = line.match(/CONFLICT\s+\([^)]+\):\s+.*in\s+(\S+)/i);
          if (m3 && m3[1] && !conflictFiles.includes(m3[1].trim())) {
            conflictFiles.push(m3[1].trim());
            continue;
          }
        }
        if (conflictFiles.length > 0 || combined.includes('CONFLICT')) {
          hasConflicts = true;
        }
      }

      if (hasConflicts) {
        return {
          isRemoteUpdated: true,
          status: 'diverged',
          aheadBehind: { ahead, behind },
          conflictFiles,
          hasConflicts: true,
          message: conflictFiles.length > 0
            ? `Remote was updated (${behind} behind, ${ahead} ahead). ${conflictFiles.length} file conflict${conflictFiles.length !== 1 ? 's' : ''} detected.`
            : `Remote was updated (${behind} behind, ${ahead} ahead). Conflicts detected. Pull or rebase before pushing.`,
          remoteBranch: upstreamRef,
        };
      }

      return {
        isRemoteUpdated: true,
        status: 'diverged',
        aheadBehind: { ahead, behind },
        conflictFiles,
        hasConflicts: false,
        message: `Remote repository has new changes (${behind} commit${behind !== 1 ? 's' : ''} behind, ${ahead} ahead). Pull or rebase before pushing.`,
        remoteBranch: upstreamRef,
      };
    } catch (err: any) {
      return {
        isRemoteUpdated: false,
        status: 'error',
        aheadBehind: { ahead: 0, behind: 0 },
        conflictFiles: [],
        hasConflicts: false,
        message: `Could not check remote status: ${err.message || 'Unknown error'}`,
      };
    }
  }

  async rebase(ref: string, options?: { autostash?: boolean; rebaseMerges?: boolean }): Promise<void> {
    const args = ['rebase'];
    if (options?.autostash) {
      args.push('--autostash');
    }
    if (options?.rebaseMerges) {
      args.push('--rebase-merges');
    }
    args.push(ref);
    await this.exec(args);
  }

  async rebaseContinue(): Promise<void> {
    await this.exec(['rebase', '--continue'], undefined, { GIT_EDITOR: 'true' });
  }

  async rebaseSkip(): Promise<void> {
    await this.exec(['rebase', '--skip']);
  }

  async rebaseAbort(): Promise<void> {
    await this.exec(['rebase', '--abort']);
  }

  /**
   * Reads rebase metadata from .git/rebase-merge or .git/rebase-apply
   * to determine current step, total steps, onto commit, and branch being rebased.
   */
  async getRebaseProgress(): Promise<RebaseProgress | undefined> {
    try {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');

      let dir = '';
      try {
        const out = await this.exec(['rev-parse', '--git-path', 'rebase-merge']);
        dir = out.trim();
        const { stat } = await import('fs/promises');
        await stat(dir);
      } catch {
        dir = '';
      }

      if (!dir) {
        try {
          const out = await this.exec(['rev-parse', '--git-path', 'rebase-apply']);
          dir = out.trim();
          const { stat } = await import('fs/promises');
          await stat(dir);
        } catch {
          dir = '';
        }
      }

      if (!dir) return undefined;

      let currentStep = 1;
      let totalSteps = 1;
      let onto = '';
      let branch = '';

      try {
        const msgnum = await readFile(join(dir, 'msgnum'), 'utf-8');
        currentStep = parseInt(msgnum.trim(), 10) || 1;
      } catch { /* ignore */ }

      try {
        const end = await readFile(join(dir, 'end'), 'utf-8');
        totalSteps = parseInt(end.trim(), 10) || 1;
      } catch { /* ignore */ }

      try {
        const ontoContent = await readFile(join(dir, 'onto'), 'utf-8');
        onto = ontoContent.trim();
      } catch { /* ignore */ }

      try {
        const headName = await readFile(join(dir, 'head-name'), 'utf-8');
        branch = headName.trim().replace(/^refs\/heads\//, '');
      } catch { /* ignore */ }

      return {
        currentStep,
        totalSteps,
        onto,
        branch,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Fetch the list of commits that will be affected by an interactive rebase
   * onto baseRef, in the chronological order Git rebase processes them (oldest to newest).
   */
  async getRebaseCommits(baseRef: string): Promise<RebaseCommitItem[]> {
    try {
      let range = `${baseRef}..HEAD`;
      try {
        await this.exec(['rev-parse', '--verify', `${baseRef}^`]);
      } catch {
        // Base commit has no parent (root commit)
        range = `${baseRef}..HEAD`;
      }

      const out = await this.exec([
        'log',
        '--reverse',
        '--format=%H\x1f%h\x1f%s\x1f%an\x1f%ae\x1f%at',
        range,
      ]);

      const lines = out.trim().split('\n').filter(Boolean);
      const items: RebaseCommitItem[] = [];

      for (const line of lines) {
        const parts = line.split('\x1f');
        if (parts.length >= 6) {
          items.push({
            hash: parts[0]!.trim(),
            shortHash: parts[1]!.trim(),
            subject: parts[2]!.trim(),
            author: parts[3]!.trim(),
            authorEmail: parts[4]!.trim(),
            timestamp: parseInt(parts[5]!.trim(), 10) || Math.floor(Date.now() / 1000),
            action: 'pick',
          });
        }
      }

      return items;
    } catch (err: any) {
      this.outputChannel.appendLine(`[GitService] Failed to get rebase commits: ${err.message}`);
      return [];
    }
  }

  /**
   * Execute an interactive rebase with customized commit items (order and actions: pick, reword, edit, squash, fixup, drop).
   * Uses cross-platform script runners to inject the custom todo list into Git.
   */
  async executeInteractiveRebase(
    baseRef: string,
    items: RebaseCommitItem[],
    options?: { autostash?: boolean; rebaseMerges?: boolean }
  ): Promise<{ success: boolean; paused?: boolean; error?: string }> {
    const { join } = await import('path');
    const { writeFileSync, unlinkSync } = await import('fs');
    const { tmpdir } = await import('os');

    const timestamp = Date.now();
    const tempTodoFile = join(tmpdir(), `git-atlas-todo-${timestamp}.txt`);
    const tempSeqScript = join(tmpdir(), `git-atlas-seq-${timestamp}.js`);
    const tempFiles: string[] = [tempTodoFile, tempSeqScript];

    const toPosix = (p: string) => p.replace(/\\/g, '/');

    try {
      // 1. Build the customized todo list
      const todoLines: string[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        if (item.action === 'drop') {
          todoLines.push(`drop ${item.shortHash} ${item.subject}`);
        } else if (item.action === 'reword' && item.newMessage && item.newMessage.trim() !== item.subject.trim()) {
          const msgFile = join(tmpdir(), `git-atlas-msg-${item.shortHash}-${timestamp}.txt`);
          tempFiles.push(msgFile);
          writeFileSync(msgFile, item.newMessage.trim(), 'utf-8');
          // Pick the commit, then exec git commit --amend using the temp file
          todoLines.push(`pick ${item.shortHash} ${item.subject}`);
          todoLines.push(`exec git commit --amend -F "${toPosix(msgFile)}"`);
        } else {
          // If first item is squash/fixup (which is invalid in git), fallback to pick
          const action = (i === 0 && (item.action === 'squash' || item.action === 'fixup'))
            ? 'pick'
            : item.action;
          todoLines.push(`${action} ${item.shortHash} ${item.subject}`);
        }
      }

      writeFileSync(tempTodoFile, todoLines.join('\n') + '\n', 'utf-8');

      // 2. Create the node runner script for GIT_SEQUENCE_EDITOR
      // Git invokes: GIT_SEQUENCE_EDITOR <path-to-git-rebase-todo>
      // The runner replaces the git-rebase-todo file with our prepared todo file.
      const runnerCode = [
        `const fs = require('fs');`,
        `try {`,
        `  fs.copyFileSync('${toPosix(tempTodoFile)}', process.argv[2]);`,
        `} catch (e) {`,
        `  console.error(e);`,
        `  process.exit(1);`,
        `}`,
      ].join('\n');

      writeFileSync(tempSeqScript, runnerCode, 'utf-8');

      // 3. Assemble command arguments
      const args = ['rebase', '-i'];
      if (options?.autostash ?? true) {
        args.push('--autostash');
      }
      if (options?.rebaseMerges) {
        args.push('--rebase-merges');
      }
      args.push(baseRef);

      this.outputChannel.appendLine(`[GitService] > git ${args.join(' ')} (interactive rebase)`);

      const seqEditorCmd = `node "${toPosix(tempSeqScript)}"`;

      await execFileAsync(this.gitPath, args, {
        cwd: this.workspaceRoot,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_SEQUENCE_EDITOR: seqEditorCmd,
          GIT_EDITOR: 'true',
        },
      });

      return { success: true };
    } catch (err: any) {
      const state = await this.getRepositoryState();
      if (state === 'rebasing') {
        // Paused due to conflicts or edit instruction
        this.outputChannel.appendLine('[GitService] Interactive rebase paused (state: rebasing).');
        return { success: true, paused: true };
      }

      const errMsg = err.stderr?.trim() || err.message || 'Unknown error during interactive rebase';
      this.outputChannel.appendLine(`[GitService] Interactive rebase error: ${errMsg}`);
      return { success: false, error: errMsg };
    } finally {
      // Clean up temp files
      for (const file of tempFiles) {
        try {
          unlinkSync(file);
        } catch { /* ignore */ }
      }
    }
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

  async push(branch?: string, mode?: 'normal' | 'force-with-lease' | 'force'): Promise<void> {
    const args = ['push'];
    if (mode === 'force-with-lease') args.push('--force-with-lease');
    else if (mode === 'force') args.push('--force');

    if (branch) {
      args.push('origin', branch);
    }
    await this.exec(args);
  }

  async fetch(remote?: string): Promise<void> {
    const args = ['fetch', '--prune'];
    if (remote) {
      args.push(remote);
    }
    await this.exec(args);
  }

  async pull(remote?: string, branch?: string): Promise<void> {
    const args = ['pull'];
    if (remote) {
      args.push(remote);
      if (branch) {
        args.push(branch);
      }
    }
    await this.exec(args);
  }

  async show(ref: string, relativePath: string): Promise<string> {
    const stdout = await this.exec(['show', `${ref}:${relativePath}`]);
    return stdout;
  }

  async createCommit(message: string, date?: string): Promise<void> {
    const status = await this.getStatus();
    // If nothing is staged yet, stage everything before committing
    if (status.staged.length === 0) {
      await this.exec(['add', '-A']);
    }
    const extraEnv: Record<string, string> = {};
    if (date) {
      extraEnv.GIT_AUTHOR_DATE = date;
      extraEnv.GIT_COMMITTER_DATE = date;
    }
    await this.exec(['commit', '-m', message], undefined, extraEnv);
  }

  async amendCommit(): Promise<void> {
    await this.exec(['commit', '--amend', '--no-edit']);
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
      // Restore tracked file to HEAD state
      await this.exec(['restore', relativePath]);
    } catch {
      // For untracked files, clean them
      await this.exec(['clean', '-f', relativePath]);
    }
  }

  async discardAll(): Promise<void> {
    // Restore all tracked changes
    await this.exec(['restore', '.']);
    // Remove all untracked files/directories
    await this.exec(['clean', '-fd']);
  }

  /**
   * Check a list of staged file paths for sensitive patterns.
   * Returns an array of { path, description } for each match.
   */
  checkSensitiveFiles(filePaths: string[]): { path: string; description: string }[] {
    const warnings: { path: string; description: string }[] = [];
    for (const filePath of filePaths) {
      // Normalize path separators for matching
      const normalized = filePath.replace(/\\/g, '/');
      for (const { pattern, description } of SENSITIVE_PATTERNS) {
        if (pattern.test(normalized)) {
          warnings.push({ path: filePath, description });
          break; // One warning per file is enough
        }
      }
    }
    return warnings;
  }

  /**
   * Add a pattern to .gitignore file. Creates the file if it doesn't exist.
   * Also unstages the file if it was staged.
   */
  async addToGitignore(pattern: string): Promise<void> {
    const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
    let content = '';
    try {
      content = fs.readFileSync(gitignorePath, 'utf-8');
    } catch {
      // File doesn't exist yet — we'll create it
    }

    // Check if the pattern is already in .gitignore
    const lines = content.split('\n').map(l => l.trim());
    if (lines.includes(pattern.trim())) {
      return; // Already present
    }

    // Append the pattern
    const newLine = content.endsWith('\n') || content === '' ? '' : '\n';
    fs.writeFileSync(gitignorePath, content + newLine + pattern + '\n', 'utf-8');

    // Unstage the file if it was staged
    try {
      await this.exec(['rm', '--cached', '--ignore-unmatch', pattern]);
    } catch {
      // Ignore — may not be tracked
    }
  }

  /**
   * Search for a file across the entire Git history.
   * Returns all commits that include the given file path.
   */
  async searchFileInHistory(filePath: string): Promise<{
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    date: string;
  }[]> {
    try {
      const output = await this.exec([
        'log', '--all', '--full-history',
        '--format=%H|%h|%s|%an|%ai',
        '--', filePath,
      ]);
      const lines = output.trim().split('\n').filter(Boolean);
      return lines.map(line => {
        const [hash, shortHash, message, author, date] = line.split('|');
        return { hash, shortHash, message, author, date };
      });
    } catch {
      return [];
    }
  }

  /**
   * Purge a file from the entire Git history using filter-branch.
   * This rewrites history so that the file never existed in any commit.
   *
   * Steps:
   * 1. Stash any uncommitted changes (filter-branch requires a clean index)
   * 2. Rewrite all history with filter-branch to remove the file
   * 3. Pop the stash to restore the user's working state
   * 4. Clean up backup refs and garbage collect
   * 5. Force push to sync with remote (if requested)
   */
  async purgeFileFromHistory(filePath: string, forcePush: boolean = false): Promise<string> {
    const log: string[] = [];

    // Step 1: Stash any uncommitted changes (filter-branch requires clean index)
    let didStash = false;
    try {
      const status = await this.getStatus();
      const hasChanges =
        status.staged.length > 0 ||
        status.modified.length > 0 ||
        status.untracked.length > 0;

      if (hasChanges) {
        await this.exec(['stash', 'push', '-u', '-m', 'git-atlas: auto-stash before purge']);
        didStash = true;
        log.push('Stashed uncommitted changes.');
      }
    } catch {
      // If stash fails, try to proceed anyway
    }

    // Step 2: Rewrite entire history to remove the file/folder from all commits
    // We must properly quote the file path so the shell eval inside filter-branch doesn't split it on spaces
    const escapedFilePath = filePath.replace(/'/g, "'\\''");
    const filterCmd = `git rm -r --cached --ignore-unmatch '${escapedFilePath}'`;
    try {
      await execFileAsync(this.gitPath, [
        'filter-branch',
        '--force',
        '--index-filter', filterCmd,
        '--prune-empty',
        '--tag-name-filter', 'cat',
        '--', '--all',
      ], {
        cwd: this.workspaceRoot,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: '0',
          FILTER_BRANCH_SQUELCH_WARNING: '1',
        },
      });
      log.push(`Rewrote Git history — '${filePath}' has been purged from all commits.`);
    } catch (err: any) {
      // filter-branch may print to stderr even on success
      const stderr = err.stderr || '';
      if (stderr.includes('Ref') && stderr.includes('was rewritten')) {
        log.push(`Rewrote Git history — '${filePath}' has been purged from all commits.`);
      } else {
        // Pop stash before throwing so we don't lose changes
        if (didStash) {
          try { await this.exec(['stash', 'pop']); } catch { /* ignore */ }
        }
        throw new Error(`filter-branch failed: ${stderr || err.message}`);
      }
    }

    // Step 3: Pop the stash to restore working state
    if (didStash) {
      try {
        await this.exec(['stash', 'pop']);
        log.push('Restored stashed changes.');
      } catch {
        log.push('Warning: Could not restore stash automatically. Run `git stash pop` manually.');
      }
    }

    // Step 4: Clean up backup refs created by filter-branch
    try {
      const refsOutput = await this.exec([
        'for-each-ref', '--format=%(refname)', 'refs/original/',
      ]);
      const refs = refsOutput.trim().split('\n').filter(Boolean);
      for (const ref of refs) {
        await this.exec(['update-ref', '-d', ref]);
      }
      log.push('Cleaned up backup refs.');
    } catch {
      // Non-critical — backup refs may not exist
    }

    // Step 5: Expire reflogs and garbage collect
    try {
      await this.exec(['reflog', 'expire', '--expire=now', '--all']);
      await this.exec(['gc', '--prune=now', '--aggressive']);
      log.push('Expired reflogs and garbage collected.');
    } catch {
      // Non-critical
    }

    // Step 6: Force push to remote if requested
    if (forcePush) {
      try {
        const head = await this.getHead();
        if (head.branch) {
          // Use --force (not --force-with-lease) because filter-branch makes
          // the lease info stale, causing --force-with-lease to always reject
          await this.exec(['push', 'origin', head.branch, '--force']);
          log.push(`Force-pushed '${head.branch}' to origin. Remote is now in sync.`);
        } else {
          log.push('Warning: HEAD is detached — cannot determine branch for force push. Push manually with: git push origin <branch> --force-with-lease');
        }
      } catch (err: any) {
        const stderr = err.stderr || err.message || '';
        log.push(`Warning: Force push failed: ${stderr}. Push manually with: git push origin <branch> --force-with-lease`);
      }
    }

    return log.join('\n');
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

  async applyStash(index: number): Promise<void> {
    await this.exec(['stash', 'apply', `stash@{${index}}`]);
  }

  async popStash(index: number): Promise<void> {
    await this.exec(['stash', 'pop', `stash@{${index}}`]);
  }

  async dropStash(index: number): Promise<void> {
    await this.exec(['stash', 'drop', `stash@{${index}}`]);
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

  /**
   * Drops a commit from the current branch's history.
   * Ensures the commit is an ancestor of HEAD before proceeding.
   */
  async deleteCommit(hash: string): Promise<void> {
    try {
      // Check if it's an ancestor of HEAD
      await this.exec(['merge-base', '--is-ancestor', hash, 'HEAD']);
    } catch {
      throw new Error(`Commit ${hash.substring(0, 7)} is not in the history of the current branch. Please switch to a branch that contains this commit first.`);
    }

    try {
      // Check if it's the root commit
      await this.exec(['rev-parse', '--verify', `${hash}^`]);
    } catch {
      throw new Error(`Cannot delete the root commit of the repository.`);
    }

    try {
      // Rebase to drop the commit: git rebase --onto <hash>^ <hash>
      await this.exec(['rebase', '--onto', `${hash}^`, hash]);
    } catch (err: any) {
      const output = (err.stdout || '') + ' ' + (err.stderr || '');
      const isConflict = output.toLowerCase().includes('conflict') || output.toLowerCase().includes('could not apply');

      if (err.stderr) {
        this.outputChannel.appendLine(`[GitService] ERROR: ${err.stderr.trim()}`);
      }
      try {
        await this.exec(['rebase', '--abort']);
        this.outputChannel.appendLine('[GitService] Rebase aborted after failure.');
      } catch {
        // Ignore
      }

      if (isConflict) {
        throw new Error('Cannot delete this commit because subsequent commits depend on its changes. The operation was safely aborted.');
      }
      throw err;
    }
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
