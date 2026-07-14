/**
 * ActionButton — Styled button for a Git action in the Inspector panel.
 *
 * Features:
 * - Icon mapping per action kind
 * - Danger variant with red gradient for destructive actions
 * - Disabled state with tooltip explaining why
 * - Hover micro-animation (lift + glow)
 */

import React, { useCallback } from 'react';
import { motion } from 'framer-motion';
import type { ValidAction, EdgeKind } from '../types';

interface ActionButtonProps {
  action: ValidAction;
  onAction: (kind: EdgeKind) => void;
}

const ACTION_ICONS: Record<string, string> = {
  checkout: '↗',
  branch: '⎇',
  tag: '🏷',
  merge: '⤵',
  rebase: '⤴',
  'cherry-pick': '🍒',
  reset: '⟲',
  push: '↑',
  pull: '↓',
  fetch: '↓',
  commit: '✓',
  'delete-branch': '✕',
  stash: '📦',
  'apply-stash': '📤',
  'pop-stash': '📤',
};

function ActionButtonComponent({ action, onAction }: ActionButtonProps) {
  const handleClick = useCallback(() => {
    if (action.enabled) {
      onAction(action.kind);
    }
  }, [action, onAction]);

  const icon = ACTION_ICONS[action.kind] ?? '⚡';

  return (
    <motion.button
      className={`action-button ${action.isDangerous ? 'danger' : ''} ${
        !action.enabled ? 'disabled' : ''
      }`}
      onClick={handleClick}
      disabled={!action.enabled}
      title={
        action.enabled
          ? action.description
          : action.disabledReason ?? 'Not available'
      }
      whileHover={action.enabled ? { y: -2, scale: 1.02 } : {}}
      whileTap={action.enabled ? { scale: 0.97 } : {}}
      transition={{ duration: 0.15 }}
    >
      <span className="action-button-icon">{icon}</span>
      <span className="action-button-label">{action.label}</span>
    </motion.button>
  );
}

export const ActionButton = React.memo(ActionButtonComponent);
