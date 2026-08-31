/**
 * ActionButton — Styled button for a Git action in the Inspector panel.
 *
 * Features:
 * - Icon mapping per action kind
 * - Danger variant with red gradient for destructive actions
 * - Disabled state with tooltip explaining why
 * - Hover micro-animation (lift + glow)
 */

import React, { useCallback, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ValidAction, EdgeKind } from '../types';

interface ActionButtonProps {
  action: ValidAction;
  onAction: (kind: EdgeKind, args?: any) => void;
}

const ACTION_ICONS: Record<string, string> = {
  switch: '↗',
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
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showDropdown]);

  const handleClick = useCallback(() => {
    if (!action.enabled) return;
    if (action.kind === 'push') {
      setShowDropdown((prev) => !prev);
    } else {
      onAction(action.kind);
    }
  }, [action, onAction]);

  const handleDropdownSelect = useCallback(
    (mode: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setShowDropdown(false);
      onAction(action.kind, { pushMode: mode });
    },
    [action, onAction]
  );

  const icon = ACTION_ICONS[action.kind] ?? '⚡';

  return (
    <div
      className="action-button-wrapper"
      style={{ position: 'relative' }}
      ref={dropdownRef}
      title={
        action.enabled
          ? action.description
          : action.disabledReason ?? 'Not available'
      }
    >
      <motion.button
        className={`action-button ${action.isDangerous ? 'danger' : ''} ${
          !action.enabled ? 'disabled' : ''
        } ${showDropdown ? 'active' : ''}`}
        onClick={handleClick}
        disabled={!action.enabled}
        style={!action.enabled ? { pointerEvents: 'none' } : {}}
        whileHover={action.enabled && !showDropdown ? { y: -2, scale: 1.02 } : {}}
        whileTap={action.enabled ? { scale: 0.97 } : {}}
        transition={{ duration: 0.15 }}
      >
        <span className="action-button-icon">{icon}</span>
        <span className="action-button-label">{action.label}</span>
      </motion.button>
      
      <AnimatePresence>
        {showDropdown && (
          <motion.div
            className="action-dropdown-menu"
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 4 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15 }}
          >
            <div className="action-dropdown-item" onClick={(e) => handleDropdownSelect('normal', e)}>
              <div className="action-dropdown-title">Normal Push</div>
              <div className="action-dropdown-desc">Safe push, aborts if remote has changes</div>
            </div>
            <div className="action-dropdown-item" onClick={(e) => handleDropdownSelect('force-with-lease', e)}>
              <div className="action-dropdown-title">Force Push with Lease</div>
              <div className="action-dropdown-desc">Safe force push, protects remote changes</div>
            </div>
            <div className="action-dropdown-item danger" onClick={(e) => handleDropdownSelect('force', e)}>
              <div className="action-dropdown-title">Force Push</div>
              <div className="action-dropdown-desc">Destructive force push, overwrites remote</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const ActionButton = React.memo(ActionButtonComponent);
