/**
 * DiffStatBar — Displays per-file diff statistics.
 *
 * Features:
 * - Horizontal bar with green (insertions) / red (deletions) proportional segments
 * - File path with extension-based icon
 * - Shows +/- counts
 * - Compact rendering for the inspector panel
 */

import React from 'react';
import type { DiffFileStat } from '../types';

interface DiffStatBarProps {
  stat: DiffFileStat;
  maxChanges: number;
}

function DiffStatBarComponent({ stat, maxChanges }: DiffStatBarProps) {
  const total = stat.insertions + stat.deletions;
  const barWidth = maxChanges > 0 ? Math.min((total / maxChanges) * 100, 100) : 0;
  const insertPct = total > 0 ? (stat.insertions / total) * 100 : 0;

  const fileName = stat.path.split('/').pop() ?? stat.path;
  const dirPath = stat.path.includes('/')
    ? stat.path.substring(0, stat.path.lastIndexOf('/'))
    : '';
  const ext = fileName.includes('.') ? fileName.split('.').pop() : '';
  const fileIcon = getFileIcon(ext ?? '');

  return (
    <div className="diff-stat-row">
      <div className="diff-stat-file">
        <span className="diff-stat-icon">{fileIcon}</span>
        <span className="diff-stat-name" title={stat.path}>
          {fileName}
        </span>
        {dirPath && (
          <span className="diff-stat-dir" title={stat.path}>
            {dirPath}
          </span>
        )}
      </div>
      <div className="diff-stat-numbers">
        {stat.isBinary ? (
          <span className="diff-stat-binary">BIN</span>
        ) : (
          <>
            {stat.insertions > 0 && (
              <span className="diff-stat-add">+{stat.insertions}</span>
            )}
            {stat.deletions > 0 && (
              <span className="diff-stat-del">−{stat.deletions}</span>
            )}
          </>
        )}
      </div>
      <div className="diff-stat-bar-container">
        <div
          className="diff-stat-bar"
          style={{ width: `${barWidth}%` }}
        >
          <div
            className="diff-stat-bar-insert"
            style={{ width: `${insertPct}%` }}
          />
          <div
            className="diff-stat-bar-delete"
            style={{ width: `${100 - insertPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function getFileIcon(ext: string): string {
  const icons: Record<string, string> = {
    ts: '🟦',
    tsx: '⚛',
    js: '🟨',
    jsx: '⚛',
    css: '🎨',
    html: '🌐',
    json: '📋',
    md: '📝',
    svg: '🖼',
    png: '🖼',
    jpg: '🖼',
    gif: '🖼',
    py: '🐍',
    rs: '🦀',
    go: '🐹',
    lock: '🔒',
  };
  return icons[ext] ?? '📄';
}

export const DiffStatBar = React.memo(DiffStatBarComponent);
