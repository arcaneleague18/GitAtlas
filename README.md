# Git Tree Explorer

Git Tree Explorer is a VS Code extension that transforms Git into an interactive visual graph. It helps you understand Git through visualization rather than memorizing commands, treating Git as a visual state machine.

![Git Tree Explorer Concept](https://raw.githubusercontent.com/microsoft/vscode-extension-samples/main/webview-view-sample/media/icon.png) *Replace with actual screenshot later*

## Philosophy

- **Where am I?** Instantly see your HEAD, current branch, and repository state.
- **What can I do from here?** View valid Git actions based on your current node.
- **What will happen if I do it?** Preview changes before executing them.

The UI makes Git feel like navigating a flowchart instead of using a terminal.

## Features

- **Interactive Graph Webview:** A React Flow based visual Directed Acyclic Graph (DAG) of your commit history.
- **Node Inspector & Action Previews:** Click any commit to see a premium slide-out panel with full details, diff statistics, and valid Git actions.
- **Visual Previews:** Before executing any dangerous action, the graph visually previews what will happen (e.g., highlighting commits that will be dropped during a reset).
- **Git Action Execution:** Execute operations (Checkout, Branch, Merge, Rebase, Cherry-Pick, Reset) directly from the graph with native VS Code confirmation dialogs.
- **Robust Error Handling:** Intercepts common Git errors (Merge Conflicts, Dirty Working Tree) and converts them into user-friendly explanations with suggested next steps.
- **Repository Sidebar:** An organized tree view showing your current state, branches, recent commits, working directory, stashes, tags, and remotes.
- **Auto-Refresh:** Automatically updates the graph and sidebar when you perform Git actions externally (watches `.git` folder).
- **Premium Design:** Glassmorphic elements, smooth animations, dynamic edge highlighting for valid actions, and full VS Code theme integration (Dark, Light, High Contrast).

## Installation

This extension is currently in development. To run it locally:

1. Clone the repository.
2. Open the `gitvis` folder in VS Code.
3. Run `npm install` in the root directory.
4. Run `cd webview && npm install` to install webview dependencies.
5. Press `F5` to launch the Extension Development Host.
6. Open a Git repository in the newly opened VS Code window to see the extension in action.

## Development Architecture

The extension consists of two main parts:

1. **Extension Host (Node.js):**
   - Manages Git CLI communication.
   - Reconstructs the Git state graph (`StateEngine`).
   - Manages VS Code providers (`SidebarProvider`, `GraphPanelProvider`).
   - Bundled securely using `esbuild`.

2. **Webview (React / Vite):**
   - A sandboxed React application.
   - Uses `React Flow` for rendering the interactive DAG.
   - `dagre` for graph layout.
   - `zustand` for state management.
   - Built securely via `vite`.

## Roadmap

- **Phase 1 (Completed):** Core graph visualization and VS Code sidebar integration.
- **Phase 2 (Completed):** Node Inspector, Details Panel, and dynamic valid action highlighting.
- **Phase 3 (Completed):** Action Execution (Merge, Rebase, Checkout, Reset) with Visual Previews and robust error handling.
- **Phase 4:** GitHub integration (PRs, Issues, Actions).
- **Phase 5:** AI assistant sidebar.
- **Phase 6:** Advanced animations, polishing, time-travel visualization, and performance optimizations.
## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

MIT License
