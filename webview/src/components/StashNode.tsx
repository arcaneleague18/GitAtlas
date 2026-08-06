import { Handle, Position, NodeProps } from '@xyflow/react';
import { useGraphStore } from '../store/graph.store';

export function StashNode({ data, selected }: NodeProps) {
  const { theme } = useGraphStore();
  const message = data.message as string;
  const index = data.index as number;

  const isLight = theme === 'light';
  
  // Base styling for stash: orange, dashed border, box shape
  const bgColor = isLight ? '#fdf2e9' : '#2d1e10';
  const borderColor = '#f78166'; // orange
  const textColor = isLight ? '#24292f' : '#c9d1d9';

  return (
    <>
      {/* Target handle (from the parent commit) */}
      <Handle type="target" position={Position.Bottom} style={{ opacity: 0 }} />
      
      <div
        className={`stash-node ${selected ? 'selected' : ''}`}
        style={{
          padding: '8px 12px',
          backgroundColor: bgColor,
          border: `2px dashed ${borderColor}`,
          borderRadius: '4px',
          color: textColor,
          fontSize: '12px',
          boxShadow: selected ? `0 0 0 2px ${borderColor}` : '0 2px 4px rgba(0,0,0,0.2)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          maxWidth: '200px',
        }}
      >
        <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ 
            backgroundColor: borderColor, 
            color: '#fff', 
            padding: '2px 4px', 
            borderRadius: '2px', 
            fontSize: '10px' 
          }}>
            stash@&#123;{index}&#125;
          </span>
        </div>
        <div style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          opacity: 0.9,
        }} title={message}>
          {message}
        </div>
      </div>
      
      {/* Source handle (not really used, but good to have) */}
      <Handle type="source" position={Position.Top} style={{ opacity: 0 }} />
    </>
  );
}
