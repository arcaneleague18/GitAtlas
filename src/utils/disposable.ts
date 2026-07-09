/**
 * Lifecycle helpers for managing VS Code Disposable resources.
 *
 * Provides a base class that collects disposables and cleans them up
 * when the extension deactivates or a component is destroyed.
 */

import * as vscode from 'vscode';

/**
 * Base class for objects that own disposable resources.
 * Subclasses push disposables into `this.disposables` and
 * call `this.dispose()` (or let the extension manage it)
 * to clean up.
 */
export abstract class DisposableBase implements vscode.Disposable {
  protected readonly disposables: vscode.Disposable[] = [];

  /**
   * Register a disposable to be cleaned up when this object is disposed.
   */
  protected register<T extends vscode.Disposable>(disposable: T): T {
    this.disposables.push(disposable);
    return disposable;
  }

  /**
   * Dispose all registered disposables.
   */
  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}

/**
 * Create a disposable from a cleanup function.
 */
export function toDisposable(fn: () => void): vscode.Disposable {
  return { dispose: fn };
}

/**
 * Debounce a function, returning a disposable that cancels the timer.
 */
export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  delayMs: number
): T & vscode.Disposable {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const debounced = ((...args: Parameters<T>) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), delayMs);
  }) as T & vscode.Disposable;

  debounced.dispose = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return debounced;
}
