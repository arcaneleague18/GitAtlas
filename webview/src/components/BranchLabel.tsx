/**
 * BranchLabel — Floating label node for branches and tags.
 *
 * Used as a standalone React Flow node that sits alongside
 * the commit graph to indicate branch tips and tag positions.
 *
 * This component is for Phase 2+ when we add branch label nodes
 * to the graph view. For now, branch labels are rendered as
 * badges inside CommitNode.
 */

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';

interface BranchLabelDataType {
  name: string;
  kind: 'local-branch' | 'current-branch' | 'remote-branch' | 'tag-label';
  color: string;
}

function BranchLabelComponent({ data }: NodeProps) {
  const labelData = data as unknown as BranchLabelDataType;

  const icon = {
    'local-branch': '⎇',
    'current-branch': '●',
    'remote-branch': '☁',
    'tag-label': '🏷',
  }[labelData.kind];

  return (
    <div className={`branch-label-node ${labelData.kind}`}>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: 'transparent', border: 'none', width: 1, height: 1 }}
      />
      <span className="branch-label-icon">{icon}</span>
      <span>{labelData.name}</span>
    </div>
  );
}

export const BranchLabel = React.memo(BranchLabelComponent);
