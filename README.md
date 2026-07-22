<div align="center">

   <p align="center">
   <img src="./resources/icon(1).svg" width="20%" />&nbsp;&nbsp;&nbsp;&nbsp;
   <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./resources/name-banner.svg">
      <source media="(prefers-color-scheme: light)" srcset="./resources/name-banner.svg">
      <img alt="About Me" src="./resources/name-banner.svg" width="65%">
   </picture>
   </p>

  <p><strong>Tired of git commands? Don't know which command to use? Scared what a command might do?</strong></p>

  <p><strong>Instead, transform Git into an interactive visual graph and explore your repository</strong></p>

  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
  [![VS Code](https://img.shields.io/badge/VS%20Code-1.90.0+-blueviolet.svg)](https://code.visualstudio.com/)
</div>

---

Git Atlas is a VS Code extension that replaces the mental overhead of Git with a beautiful, interactive visual graph. Understand Git through visualization rather than memorizing commands, treating Git as a visual state machine.

## Philosophy

- **Where am I?** Instantly see your `HEAD`, current branch, and repository state.
- **What can I do from here?** View valid Git actions based on your current node context.
- **What will happen if I do it?** Preview changes before executing them with dynamic visual highlighting.

The UI makes Git feel like navigating a flowchart instead of wrestling with a terminal.

## Features

- **Interactive Graph Webview:** A React Flow-based visual Directed Acyclic Graph (DAG) of your commit history.

- **Working Directory Node:** Uncommitted changes (staged, modified, untracked) appear directly in the graph above HEAD, so you never lose track of your work in progress. Click it to view exact diffs.

- **Node Inspector:** Click any commit to see a premium slide-out panel with full details, diff statistics, and context-aware valid Git actions.

- **Action Previews:** Before executing any action, a centered modal previews what will happen. It provides plain-English explanations of how the graph will change and clear danger warnings for destructive actions.

- **Git Action Execution:** Execute operations (Checkout, Branch, Merge, Rebase, Cherry-Pick, Reset) directly from the graph with confidence.

- **Robust Error Handling:** Intercepts common Git errors (Merge Conflicts, Dirty Working Tree) and converts them into user-friendly explanations with suggested next steps.

- **Repository Sidebar:** An organized tree view showing your current state, branches, recent commits, working directory, stashes, tags, and remotes.

- **GitHub Integration:** Automatically detects your remote and fetches Pull Requests, Issues, and CI/CD Action statuses. See CI badges and PR links directly on commits and in the sidebar.

- **AI Assistant:** An intelligent Git co-pilot in the sidebar. Ask questions about your repository state, get explanations of Git concepts, and receive suggested fixes for errors. Supports VS Code Language Models (GitHub Copilot) and custom OpenAI API keys.

- **Time-Travel (Reflog):** Visually recover lost commits using the built-in `--reflog` visualization. Orphaned commits are dynamically styled to indicate their "lost" status.

- **Auto-Refresh:** Automatically updates the graph and sidebar when you perform Git actions externally by actively watching the `.git` folder.

- **Premium Design:** Glassmorphic elements, smooth animations, dynamic edge highlighting for valid actions, and full VS Code theme integration (Dark, Light, High Contrast).

## Installation

This extension is currently in development. To run it locally:

1. Clone the repository.
2. Open the `gitvis` folder in VS Code.
3. Run `npm install` in the root directory.
4. Run `cd webview && npm install` to install webview dependencies.
5. Press `F5` to launch the Extension Development Host.
6. Open a Git repository in the newly opened VS Code window to see the extension in action!

## Development Architecture

The extension consists of two robustly decoupled parts:

1. **Extension Host (Node.js):**
   - Manages Git CLI communication (`GitService`).
   - Reconstructs the Git state graph (`StateEngine`).
   - Manages VS Code providers (`SidebarProvider`, `GraphPanelProvider`, `AiAssistantProvider`).
   - Bundled securely using `esbuild`.

2. **Webview (React / Vite):**
   - A sandboxed React application.
   - Uses `React Flow` for rendering the interactive DAG.
   - `dagre` for directed graph layout.
   - `zustand` for state management and `framer-motion` for animations.
   - Built securely via `vite`.

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request if you'd like to help make Git Atlas even better.
