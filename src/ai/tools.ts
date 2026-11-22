import type { ToolArgs } from './types.js';

export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'switch',
      description: 'Switch to a different branch or detach HEAD at a commit. Uses modern git switch instead of checkout.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Branch name or commit hash to switch to' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['ref', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_branch',
      description: 'Create a new branch, optionally at a specific commit.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name for the new branch' },
          ref: { type: 'string', description: 'Optional commit hash or branch to create from (defaults to HEAD)' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['name', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_branch',
      description: 'Delete a branch. Warning: this permanently removes the branch reference.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Branch name to delete' },
          force: { type: 'boolean', description: 'Force delete even if not fully merged (default: false)' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['name', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'merge',
      description: 'Merge a branch or commit into the current branch.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Branch name or commit hash to merge in' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['ref', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'rebase',
      description: 'Rebase the current branch onto another branch or commit.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Branch or commit hash to rebase onto' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['ref', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'cherry_pick',
      description: 'Apply changes from a specific commit onto the current branch.',
      parameters: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: 'Commit hash to cherry-pick' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['hash', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'revert',
      description: 'Create a new commit that undoes the changes of a specific commit.',
      parameters: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: 'Commit hash to revert' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['hash', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'reset',
      description: 'Reset the current branch to a specific commit. WARNING: hard reset will discard all uncommitted changes.',
      parameters: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: 'Commit hash to reset to' },
          mode: { type: 'string', enum: ['soft', 'mixed', 'hard'], description: 'Reset mode: soft (keep staged), mixed (unstage), or hard (discard all)' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['hash', 'mode', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_tag',
      description: 'Create a tag at a specific commit.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Tag name (e.g. v1.0.0)' },
          ref: { type: 'string', description: 'Optional commit hash (defaults to HEAD)' },
          message: { type: 'string', description: 'Optional tag message (creates an annotated tag)' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['name', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_tag',
      description: 'Delete a tag.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Tag name to delete' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['name', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_commit',
      description: 'Delete a commit from the history of the current branch.',
      parameters: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: 'Commit hash to delete' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['hash', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'push',
      description: 'Push local commits to the remote repository.',
      parameters: {
        type: 'object',
        properties: {
          branch: { type: 'string', description: 'Optional specific branch to push (defaults to current)' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'fetch_remote',
      description: 'Fetch updates from the remote repository without merging.',
      parameters: {
        type: 'object',
        properties: {
          remote: { type: 'string', description: 'Optional specific remote (defaults to all)' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'commit',
      description: 'Create a commit with currently staged files only. Use stage_files explicitly before committing; this tool never stages files.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Commit message' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['message', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'stage_files',
      description: 'Stage specific files or all files for commit.',
      parameters: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'string' }, description: 'File paths to stage. Use ["*"] to stage all files.' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['files', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'unstage_files',
      description: 'Unstage specific files or all files.',
      parameters: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'string' }, description: 'File paths to unstage. Use ["*"] to unstage all files.' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['files', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'discard_changes',
      description: 'Discard all uncommitted changes to a specific file. WARNING: this cannot be undone.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'File path to discard changes for' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['file', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_stash',
      description: 'Stash the current working directory changes.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Optional stash message' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_status',
      description: 'Get the current working directory status (staged, modified, untracked files). Use this to inspect the repo state before suggesting actions.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Brief explanation of why this information is needed' },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_log',
      description: 'Get recent commit history. Use this to look up commit hashes, inspect history, or find specific commits.',
      parameters: {
        type: 'object',
        properties: {
          max_count: { type: 'integer', minimum: 1, maximum: 100, description: 'Number of commits to fetch (1-100, default: 10)' },
          reason: { type: 'string', description: 'Brief explanation of why this information is needed' },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_diff',
      description: 'Get the diff statistics for a specific commit showing which files changed and how many lines were added/removed.',
      parameters: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: 'Commit hash to get diff for' },
          reason: { type: 'string', description: 'Brief explanation of why this information is needed' },
        },
        required: ['hash', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'purge_file_from_history',
      description: 'Permanently remove a file/folder from the ENTIRE Git history. This rewrites all commits using filter-branch so the file/folder never existed. Use when a sensitive file (.env, secrets, credentials, API keys) or folder was accidentally committed. WARNING: This rewrites history. Set force_push to true to automatically sync with the remote. CRITICAL: After this tool runs, do NOT reset, merge, pull, or fetch from origin — that would undo the purge.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'File/folder path to purge from history (e.g. ".env", "config/secrets.json", "node_modules/")' },
          force_push: { type: 'boolean', description: 'If true, automatically force-push to origin after purging. Recommended when the file has already been pushed to a remote.' },
          reason: { type: 'string', description: 'Brief explanation of why this file needs to be purged from history' },
        },
        required: ['file', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'reword_commit',
      description: 'Change the commit message of an existing commit. Works for HEAD commits (via amend) and older commits (via interactive rebase). WARNING: This rewrites history.',
      parameters: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: 'Full or short commit hash to reword' },
          new_message: { type: 'string', description: 'The new commit message' },
          reason: { type: 'string', description: 'Brief explanation of why this action is needed' },
        },
        required: ['hash', 'new_message', 'reason'],
      },
    },
  },
  ...(['apply_stash', 'pop_stash', 'drop_stash'] as const).map(name => ({
    type: 'function' as const,
    function: {
      name,
      description: name === 'drop_stash' ? 'Permanently delete a stash.' : name === 'pop_stash' ? 'Apply a stash and remove it on success.' : 'Apply a stash without removing it.',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'integer', minimum: 0, maximum: 10000, description: 'Stash index.' },
          reason: { type: 'string', description: 'Why this operation is needed.' },
        },
        required: ['index', 'reason'],
      },
    },
  })),
];


export const READ_ONLY_TOOLS = new Set(['get_status', 'get_log', 'get_diff']);
export const DANGEROUS_TOOLS = new Set([
  'reset', 'delete_branch', 'delete_tag', 'delete_commit', 'reword_commit',
  'discard_changes', 'purge_file_from_history', 'rebase', 'push', 'drop_stash',
]);

interface Schema {
  type: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: string[];
  minimum?: number;
  maximum?: number;
}

export function validateTool(name: string, input: unknown): ToolArgs {
  const definition = TOOL_DEFINITIONS.find(tool => tool.function.name === name);
  if (!definition) throw new Error('Unknown tool: ' + name);
  const schema = definition.function.parameters as unknown as Schema;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Tool arguments must be an object.');
  const args = input as ToolArgs;
  for (const required of schema.required ?? []) {
    if (!Object.hasOwn(args, required)) throw new Error('Missing required argument: ' + required);
  }
  const validate = (value: unknown, rule: Schema, key: string): void => {
    if (rule.type === 'array') {
      if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw new Error(key + ' must contain 1-100 items.');
      for (const item of value) validate(item, rule.items!, key);
    } else if (rule.type === 'integer' || rule.type === 'number') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < (rule.minimum ?? 0) || value > (rule.maximum ?? 100)) throw new Error(key + ' is outside its allowed range.');
    } else if (rule.type === 'string') {
      if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > 20000) throw new Error(key + ' must be a nonempty string of at most 20000 characters.');
      if (rule.enum && !rule.enum.includes(value)) throw new Error('Invalid ' + key);
    } else if (rule.type === 'boolean' && typeof value !== 'boolean') throw new Error(key + ' must be a boolean.');
  };
  for (const [key, value] of Object.entries(args)) {
    const rule = schema.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
    if (!rule) throw new Error('Unexpected argument: ' + key);
    validate(value, rule, key);
    if (['ref', 'hash', 'name', 'remote', 'branch'].includes(key) && typeof value === 'string' && (value !== value.trim() || value.startsWith('-') || /[\r\n]/.test(value))) throw new Error('Invalid reference: ' + key);
  }
  const paths = Array.isArray(args.files) ? args.files : args.file ? [args.file] : [];
  for (const file of paths) {
    if (typeof file !== 'string' || /^(?:[\\/]|[a-z]:)/i.test(file) || file.replace(/\\/g, '/').split('/').includes('..') || file.startsWith(':')) throw new Error('File paths must stay inside the repository.');
  }
  if (paths.includes('*') && paths.length !== 1) throw new Error('Use ["*"] alone to explicitly stage or unstage all files.');
  // Return an independent copy so approved arguments cannot be mutated by a caller.
  return JSON.parse(JSON.stringify(args)) as ToolArgs;
}
