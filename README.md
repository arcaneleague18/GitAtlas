# Git Tree Explorer

Git Tree Explorer is a VS Code extension that transforms Git into an interactive visual graph. It helps you understand Git through visualization rather than memorizing commands, treating Git as a visual state machine.

![Git Tree Explorer Concept](https://raw.githubusercontent.com/microsoft/vscode-extension-samples/main/webview-view-sample/media/icon.png) *Replace with actual screenshot later*

## Philosophy

- **Where am I?** Instantly see your HEAD, current branch, and repository state.
- **What can I do from here?** View valid Git actions based on your current node.
- **What will happen if I do it?** Preview changes before executing them.

The UI makes Git feel like navigating a flowchart instead of using a terminal.

## Features (Phase 1)

- **Interactive Graph Webview:** A React Flow based visual Directed Acyclic Graph (DAG) of your commit history.
- **Commit Nodes:** Premium nodes showing branch colors, HEAD indicator, commit message, short hash, time ago, and branch/tag badges. Hover over a node for full details.
- **Repository Sidebar:** An organized tree view showing:
  - Current state (clean, dirty, merging)
  - Branches (local and remote, with ahead/behind counts)
  - Recent Commits
  - Working Directory (modified, staged, untracked files)
  - Stashes
  - Tags
  - Remotes
- **Auto-Refresh:** Automatically updates the graph and sidebar when you perform Git actions externally (watches `.git` folder).
- **Smooth Navigation:** Zoom, pan, fit-to-view, and a mini-map to quickly navigate large repositories.
- **Premium Design:** Glassmorphic elements, smooth animations, and VS Code theme integration (Dark, Light, High Contrast).

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

- **Phase 1:** Core graph visualization and VS Code sidebar integration (Completed).
- **Phase 2:** Node Inspector, Details Panel, valid action highlighting.
- **Phase 3:** Dynamic action computation from graph topology.
- **Phase 4:** Git execution capabilities directly from the graph (merge, branch, checkout, reset, rebase).
- **Phase 5:** GitHub integration (PRs, Issues, Actions).
- **Phase 6:** AI assistant sidebar.
- **Phase 7:** Advanced animations, polishing, and performance optimizations.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

MIT License
