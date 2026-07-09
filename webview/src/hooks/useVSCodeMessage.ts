/**
 * useVSCodeMessage — React hook for listening to messages from the extension host.
 *
 * Sets up a `window.addEventListener('message', ...)` listener
 * and cleans up on unmount.
 */

import { useEffect } from 'react';
import type { ExtensionToWebviewMessage } from '../types';

/**
 * Listen for messages from the VS Code extension host.
 *
 * @param handler - Callback invoked for each message received.
 */
export function useVSCodeMessage(
  handler: (message: ExtensionToWebviewMessage) => void
): void {
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const message = event.data as ExtensionToWebviewMessage;
      if (message && typeof message.type === 'string') {
        handler(message);
      }
    };

    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [handler]);
}
