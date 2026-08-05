/**
 * Extension Entry Point — activates and wires up all components.
 *
 * Lifecycle:
 * 1. Detect git repository in workspace
 * 2. Instantiate GitService + RepositoryStateEngine
 * 3. Register SidebarProvider as TreeDataProvider
 * 4. Register commands (openGraph, refresh, selectNode)
 * 5. Build initial graph
 * 6. Set up file system watcher for auto-refresh
 * 7. Wire sidebar ↔ graph webview communication
 */

import * as vscode from 'vscode';
import { GitService } from './services/git.service.js';
import { RepositoryStateEngine } from './engine/state-engine.js';
import { SidebarProvider } from './providers/sidebar.provider.js';
import { GraphPanelProvider } from './providers/graph-panel.provider.js';
import { ActionExecutor } from './engine/action-executor.js';
import { GithubService } from './services/github.service.js';
import { GithubIntegrationEngine } from './engine/github-integration.js';
import { AiAssistantProvider } from './providers/ai-assistant.provider.js';
import { GitContentProvider } from './providers/git-content.provider.js';
import { debounce } from './utils/disposable.js';

/** How often to poll for changes (ms). */
const REFRESH_INTERVAL = 5000;
/** Debounce delay for file system changes (ms). */
const FS_DEBOUNCE = 1000;

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  // Find workspace root
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    // No workspace — register a placeholder sidebar
    registerPlaceholderSidebar(context);
    return;
  }

  // Create output channel for Git operations
  const outputChannel = vscode.window.createOutputChannel('Git Atlas');
  context.subscriptions.push(outputChannel);

  // Initialize Git service
  const gitService = new GitService(workspaceRoot, outputChannel);
  try {
    await gitService.initialize();
  } catch (err) {
    vscode.window.showErrorMessage(
      `Git Atlas: ${err instanceof Error ? err.message : 'Failed to initialize Git'}`
    );
    registerPlaceholderSidebar(context);
    return;
  }

  // Register the GitContentProvider for gitvis diffs
  const gitContentProvider = new GitContentProvider(gitService);
  context.subscriptions.push(gitContentProvider);

  // Check if this is a git repository
  const isRepo = await gitService.isGitRepository();
  if (!isRepo) {
    registerPlaceholderSidebar(context);
    return;
  }

  // Create state engine
  const stateEngine = new RepositoryStateEngine(gitService);
  context.subscriptions.push(stateEngine);

  // Create action executor
  const actionExecutor = new ActionExecutor(gitService, stateEngine, outputChannel);

  // Create GitHub integration
  const githubService = new GithubService(gitService, outputChannel);
  const githubIntegration = new GithubIntegrationEngine(githubService, stateEngine);
  context.subscriptions.push(githubIntegration);

  // Create sidebar provider
  const sidebarProvider = new SidebarProvider(stateEngine, githubIntegration);
  context.subscriptions.push(sidebarProvider);

  const treeView = vscode.window.createTreeView('gitTreeExplorer.sidebar', {
    treeDataProvider: sidebarProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Create graph panel provider
  const graphPanel = new GraphPanelProvider(
    context.extensionUri,
    stateEngine,
    gitService,
    actionExecutor,
    githubIntegration
  );
  context.subscriptions.push(graphPanel);

  // Create AI assistant provider
  const aiAssistant = new AiAssistantProvider(
    context.extensionUri,
    stateEngine,
    githubIntegration,
    gitService
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AiAssistantProvider.viewType,
      aiAssistant,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );
  context.subscriptions.push(aiAssistant);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('gitTreeExplorer.openGraph', () => {
      graphPanel.createOrShow();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitTreeExplorer.refresh', async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.SourceControl,
          title: 'Git Atlas: Fetching...',
        },
        async () => {
          try {
            await gitService.fetch();
            await stateEngine.buildGraph();
            vscode.window.showInformationMessage('Git Atlas: Refreshed');
          } catch (err) {
            console.error('Git Atlas: Fetch failed', err);
            vscode.window.showErrorMessage('Git Atlas: Failed to fetch from remote.');
          }
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitTreeExplorer.selectNode',
      (nodeId: string) => {
        graphPanel.focusNode(nodeId);
      }
    )
  );

  // Internal command for webview → extension node selection
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitTreeExplorer.nodeSelected',
      (_nodeId: string) => {
        // Phase 3: Open details panel, compute valid actions, etc.
      }
    )
  );

  // Build initial graph
  try {
    await stateEngine.buildGraph();
  } catch (err) {
    console.error('Git Atlas: Failed to build initial graph', err);
  }

  let isBuildingGraph = false;
  let lastGraphBuildEndTime = 0;

  // Set up file system watcher for auto-refresh
  const debouncedRefresh = debounce(async () => {
    if (isBuildingGraph) return;
    isBuildingGraph = true;
    try {
      await stateEngine.buildGraph();
    } catch (err) {
      console.error('Git Atlas: Auto-refresh failed', err);
    } finally {
      isBuildingGraph = false;
      lastGraphBuildEndTime = Date.now();
    }
  }, FS_DEBOUNCE);
  context.subscriptions.push(debouncedRefresh);

  const handleWatcherEvent = (uri: vscode.Uri) => {
    // Ignore index.lock to prevent infinite loops during git operations
    if (uri.fsPath.endsWith('index.lock')) return;
    
    // If a file changed during or within 1000ms of a graph build, 
    // it's likely a side effect of git status (e.g. updating the index stat cache)
    // This is especially common during merge conflicts.
    if (isBuildingGraph || Date.now() - lastGraphBuildEndTime < 1000) return;

    debouncedRefresh();
  };

  // Watch .git directory for changes (commits, branch switches, etc.)
  const gitWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceRoot, '.git/**')
  );
  gitWatcher.onDidChange(handleWatcherEvent);
  gitWatcher.onDidCreate(handleWatcherEvent);
  gitWatcher.onDidDelete(handleWatcherEvent);
  context.subscriptions.push(gitWatcher);

  // Watch workspace files for working directory status changes
  const fileWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceRoot, '**/*')
  );
  fileWatcher.onDidChange(handleWatcherEvent);
  fileWatcher.onDidCreate(handleWatcherEvent);
  fileWatcher.onDidDelete(handleWatcherEvent);
  context.subscriptions.push(fileWatcher);

  // Periodic refresh as a safety net
  const interval = setInterval(async () => {
    try {
      await stateEngine.buildGraph();
    } catch {
      // Silently ignore periodic refresh failures
    }
  }, REFRESH_INTERVAL);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });

  console.log('Git Atlas activated');
}

export function deactivate(): void {
  // Cleanup handled by subscriptions
}

/**
 * Get the workspace root folder path.
 */
function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  return folders[0]!.uri.fsPath;
}

/**
 * Register a placeholder sidebar when no git repository is found.
 */
function registerPlaceholderSidebar(
  context: vscode.ExtensionContext
): void {
  const placeholder: vscode.TreeDataProvider<vscode.TreeItem> = {
    getTreeItem: (element) => element,
    getChildren: () => {
      const item = new vscode.TreeItem(
        'Open a Git repository to get started',
        vscode.TreeItemCollapsibleState.None
      );
      item.iconPath = new vscode.ThemeIcon('info');
      return [item];
    },
  };

  context.subscriptions.push(
    vscode.window.createTreeView('gitTreeExplorer.sidebar', {
      treeDataProvider: placeholder,
    })
  );
}
