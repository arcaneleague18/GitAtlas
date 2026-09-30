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
  'create-tag': '🏷',
  'push-tag': '↑',
  'delete-tag': '✕',
  'delete-remote-tag': '✕',
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
  'rebase-continue': '►',
  'rebase-skip': '»',
  'rebase-abort': '✕',
  'rebase-interactive': '⚙',
  'create-tracking-branch': '⎇',
};

function ActionButtonComponent({ action, onAction }: ActionButtonProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isPushDropdown = action.kind === 'push';
  const tagList: string[] = action.args?.tags || [];
  const hasTagDropdown =
    (action.kind === 'create-tag' || action.kind === 'tag') &&
    (action.args?.hasTags === true || tagList.length > 0);
  const hasDropdown = isPushDropdown || hasTagDropdown;

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
    if (hasDropdown) {
      setShowDropdown((prev) => !prev);
    } else {
      onAction(action.kind);
    }
  }, [action, onAction, hasDropdown]);

  const handleDropdownSelect = useCallback(
    (mode: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setShowDropdown(false);
      onAction(action.kind, { pushMode: mode });
    },
    [action, onAction]
  );

  const handleTagDropdownSelect = useCallback(
    (targetKind: EdgeKind, e: React.MouseEvent) => {
      e.stopPropagation();
      setShowDropdown(false);
      onAction(targetKind, { tags: tagList, defaultTag: tagList[0] });
    },
    [onAction, tagList]
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
        {hasDropdown && (
          <span className="action-button-chevron">{showDropdown ? '\u25B4' : '\u25BE'}</span>
        )}
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
            {isPushDropdown && (
              <>
                <div className="action-dropdown-item" onClick={(e) => handleDropdownSelect('normal', e)}>
                  <div>
                    <div className="action-dropdown-title">Normal Push</div>
                    <div className="action-dropdown-desc">Safe push, aborts if remote has changes</div>
                  </div>
                </div>
                <div className="action-dropdown-item" onClick={(e) => handleDropdownSelect('force-with-lease', e)}>
                  <div>
                    <div className="action-dropdown-title">Force Push with Lease</div>
                    <div className="action-dropdown-desc">Safe force push, protects remote changes</div>
                  </div>
                </div>
                <div className="action-dropdown-item danger" onClick={(e) => handleDropdownSelect('force', e)}>
                  <div>
                    <div className="action-dropdown-title">Force Push</div>
                    <div className="action-dropdown-desc">Destructive force push, overwrites remote</div>
                  </div>
                </div>
              </>
            )}

            {hasTagDropdown && (
              <>
                <div className="action-dropdown-item" onClick={(e) => handleTagDropdownSelect('create-tag', e)}>
                  <span className="action-dropdown-icon">🏷</span>
                  <div>
                    <div className="action-dropdown-title">Create a new tag</div>
                    <div className="action-dropdown-desc">Add another tag to this commit</div>
                  </div>
                </div>
                <div className="action-dropdown-item" onClick={(e) => handleTagDropdownSelect('push-tag', e)}>
                  <span className="action-dropdown-icon">↑</span>
                  <div>
                    <div className="action-dropdown-title">Push tags to remote</div>
                    <div className="action-dropdown-desc">
                      {tagList.length === 1
                        ? `Push ${tagList[0]} onto remote (git push origin ${tagList[0]})`
                        : `Push tag(s) onto remote repository`}
                    </div>
                  </div>
                </div>
                <div className="action-dropdown-item danger" onClick={(e) => handleTagDropdownSelect('delete-tag', e)}>
                  <span className="action-dropdown-icon">✕</span>
                  <div>
                    <div className="action-dropdown-title">Delete a tag</div>
                    <div className="action-dropdown-desc">
                      {tagList.length === 1
                        ? `Delete "${tagList[0]}" from local repository`
                        : `Delete a tag from local repository`}
                    </div>
                  </div>
                </div>
                <div className="action-dropdown-item danger" onClick={(e) => handleTagDropdownSelect('delete-remote-tag', e)}>
                  <span className="action-dropdown-icon">✕</span>
                  <div>
                    <div className="action-dropdown-title">Delete tag from remote</div>
                    <div className="action-dropdown-desc">
                      {tagList.length === 1
                        ? `Delete "${tagList[0]}" from remote repository`
                        : `Delete a tag from remote repository`}
                    </div>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const ActionButton = React.memo(ActionButtonComponent);
