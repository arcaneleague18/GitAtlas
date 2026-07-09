/**
 * VS Code Webview API bridge.
 *
 * Provides type-safe access to the VS Code postMessage API
 * from within the React webview.
 *
 * The `acquireVsCodeApi` function is only available inside
 * VS Code webviews — this module wraps it safely.
 */

import type { WebviewToExtensionMessage } from './types';

/**
 * VS Code API interface as available inside webviews.
 */
interface VSCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

// Acquire the API once and cache it
let api: VSCodeApi | null = null;

function getApi(): VSCodeApi | null {
  if (api) return api;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api = (window as any).acquireVsCodeApi?.() ?? null;
  } catch {
    // Not running inside a VS Code webview (e.g., during development)
    api = null;
  }

  return api;
}

/**
 * Send a typed message to the extension host.
 */
export function postMessage(message: WebviewToExtensionMessage): void {
  const vscodeApi = getApi();
  if (vscodeApi) {
    vscodeApi.postMessage(message);
  } else {
    console.log('[VSCode Bridge] Message (dev mode):', message);
  }
}

/**
 * Save state that persists across webview hide/show cycles.
 */
export function saveState(state: unknown): void {
  const vscodeApi = getApi();
  if (vscodeApi) {
    vscodeApi.setState(state);
  }
}

/**
 * Restore previously saved state.
 */
export function restoreState<T>(): T | null {
  const vscodeApi = getApi();
  if (vscodeApi) {
    return vscodeApi.getState() as T | null;
  }
  return null;
}

/**
 * Check if we're running inside a VS Code webview.
 */
export function isVSCode(): boolean {
  return getApi() !== null;
}
