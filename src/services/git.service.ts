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

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
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
    const { stdout } = await execFileAsync(this.gitPath, args, {
      cwd: cwd ?? this.workspaceRoot,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    });
    return stdout;
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
   */
  async getLog(maxCount: number = 500): Promise<RawCommit[]> {
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
      return { modified: [], staged: [], untracked: [] };
    }

    const modified: FileChange[] = [];
    const staged: FileChange[] = [];
    const untracked: string[] = [];

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
      }
    }

    return { modified, staged, untracked };
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
