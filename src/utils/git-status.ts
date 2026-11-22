import type { RawStatus, FileChangeStatus } from '../engine/types.js';

function statusName(code: string): FileChangeStatus {
  return ({ A: 'added', D: 'deleted', R: 'renamed', C: 'copied' } as Record<string, FileChangeStatus>)[code] ?? 'modified';
}

/** Parse porcelain v2 -z output without interpreting or trimming filenames. */
export function parseGitStatus(output: string): RawStatus {
  const result: RawStatus = { modified: [], staged: [], untracked: [], conflicted: [] };
  const records = output.split('\0');
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (record.startsWith('? ')) {
      result.untracked.push(record.slice(2));
      continue;
    }
    const kind = record[0];
    if (kind !== '1' && kind !== '2' && kind !== 'u') continue;
    const fieldCount = kind === '1' ? 8 : kind === '2' ? 9 : 10;
    let offset = 0;
    for (let field = 0; field < fieldCount; field++) {
      const separator = record.indexOf(' ', offset);
      if (separator < 0) throw new Error('Invalid Git status record');
      offset = separator + 1;
    }
    const filePath = record.slice(offset);
    if (kind === '2') i++; // The next NUL-delimited record is the original path.
    if (kind === 'u') {
      result.conflicted.push({ path: filePath, status: 'conflicted' });
      continue;
    }
    const xy = record.split(' ', 2)[1]!;
    if (xy[0] !== '.') result.staged.push({ path: filePath, status: statusName(xy[0]!) });
    if (xy[1] !== '.') result.modified.push({ path: filePath, status: statusName(xy[1]!) });
  }
  return result;
}
