<div align="center">
  <p align="center">
   <img src="./resources/for_readme/icon.svg" width="20%" />&nbsp;&nbsp;&nbsp;&nbsp;
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./resources/for_readme/name-banner.svg">
      <source media="(prefers-color-scheme: light)" srcset="./resources/for_readme/name-banner.svg">
      <img alt="Git Atlas" src="./resources/for_readme/name-banner.svg" width="65%">
    </picture>
  </p>

  <p><strong>Transform Git into an interactive visual graph and explore your repository.</strong></p>

  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
  [![VS Code](https://img.shields.io/badge/VS%20Code-1.90.0+-blueviolet.svg)](https://code.visualstudio.com/)
</div>

---

**Git Atlas** replaces the mental overhead of Git with a beautiful, interactive visual graph directly inside VS Code. Understand Git through visualization rather than memorizing commands — treating your repository as a navigable state machine.

<p align="center">
  <img alt="Git Atlas Main Interface" src="./resources/for_readme/gitvis-ss.png" width="100%">
</p>

## Why Git Atlas?

- **Where am I?** Instantly see your `HEAD`, current branch, and repository state.
- **What can I do from here?** View valid Git actions based on your current node context.
- **What will happen if I do it?** Preview changes before executing them with dynamic visual highlighting.

The UI makes Git feel like navigating a flowchart instead of wrestling with a terminal.

---

## Key Features

> ### Interactive Graph & Commit Panel
Visualize your entire commit history as a Directed Acyclic Graph (DAG). View uncommitted changes in the Working Directory node, and easily commit, amend, or stash files using the dedicated commit panel.
<p align="center">
  <video autoplay loop muted playsinline src="./resources/for_readme/committing-and-pushing.mp4" width="100%"></video>
</p>


>  ### AI-Powered Git Agent
Ask questions, get repository-aware answers, and instruct the built-in AI agent to perform multi-step Git operations. It supports GitHub Copilot and open-source models!
<p align="center">
  <video autoplay loop muted playsinline src="./resources/for_readme/AI-agent.mp4" width="100%"></video>
</p>

> ### Backdating Commits
Need to backdate a commit? Easily set a custom commit date right from the commit panel. The date picker automatically constrains your choices so you can't pick a date older than the previous commit or in the future!
<p align="center">
  <video autoplay loop muted playsinline src="./resources/for_readme/backdating.mp4" width="100%"></video>
</p>

> ### Editing Commit Messages
Click any commit to edit its message. Git Atlas automatically handles `git commit --amend` for HEAD and guides you through rewriting history.
<p align="center">
  <video autoplay loop muted playsinline src="./resources/for_readme/editing-commit-msg.mp4" width="100%"></video>
</p>

> ### Purging Sensitive Files
Accidentally committed an `.env` file? Search for a file across your entire history and permanently purge it from all commits with a single click.
<p align="center">
  <video autoplay loop muted playsinline src="./resources/for_readme/purging-files.mp4" width="100%"></video>
</p>

> ### Sensitive File Detection
Warns you if you are about to commit sensitive files (e.g., credentials, build caches) and offers a one-click option to add them to `.gitignore` and unstage them before committing.
<p align="center">
  <img alt="Sensitive File Detection" src="./resources/for_readme/commit-panel.png" width="100%">
</p>

---

## Additional Features

- **Action Previews** — Before executing any action, a centered modal previews what will happen, with clear danger warnings for destructive operations.
- **GitHub Integration** — Detects your remote and fetches Pull Requests, Issues, and CI/CD Action statuses. See CI badges and PR links directly on commits.
- **Time-Travel (Reflog)** — Visually recover lost commits using `--reflog` visualization. Orphaned commits are distinctly styled.
- **AI Error Explanation** — When any Git action fails, the extension immediately asks an available language model to explain *why* it failed and what you should do.

---

## Architecture

Git Atlas has two decoupled runtimes that communicate over VS Code's message-passing bridge.

```mermaid
graph TB
    subgraph Host["Extension Host  (Node.js · esbuild)"]
        GS["GitService\nspawns git CLI"]
        GHS["GithubService\nfetches PRs · Issues · CI"]
        SE["StateEngine\nbuilds immutable graph\nassigns branch colors"]
        AE["ActionEngine\ncomputes valid actions\ngenerates previews"]
        AX["ActionExecutor\nruns git commands\nAI error explanation"]
        GP["GraphPanelProvider\nserializes graph → JSON\nroutes webview messages"]
        SP["SidebarProvider\nTreeDataProvider"]
        AI["AiAssistantProvider\nagentic tool-call loop\nmulti-provider LLM"]
    end

    subgraph WV["Webview  (React · Vite)"]
        Store["Zustand Store\ndeserializes graph\ncolor propagation"]
        Graph["GraphView\nReact Flow DAG\nDagre layout"]
        Inspector["NodeInspector\naction buttons · diff stats\ncommit reword"]
        ChatUI["AI Assistant UI\nchat · tool-call cards"]
    end

    Git[("git CLI")]
    GitHub[("GitHub API")]
    LM[("vscode.lm\nCopilot / OpenRouter\nGroq / Ollama")]

    GS -->|spawn| Git
    GHS -->|fetch| GitHub
    AI & AX -->|selectChatModels| LM

    GS --> SE
    SE -->|onDidChangeGraph| GP & SP & AI
    AE --> GP
    AX --> GS & SE
    GP <-->|postMessage| Store
    AI <-->|postMessage| ChatUI
    Store --> Graph & Inspector
    Inspector -->|action-requested| GP
```

### Design Principles

| | |
|---|---|
| **Immutable snapshots** | `StateEngine` produces a new `RepositoryGraph` on every rebuild — never mutates in place |
| **Layered architecture** | `GitService` → `StateEngine` → `ActionExecutor` → `Providers` → Webview |
| **Secure sandboxing** | Webview has zero Node.js access; all git I/O runs in the Extension Host |
| **Reactive UI** | `onDidChangeGraph` drives all refreshes — the webview never polls |
| **AI as enhancement** | Error explanation and the AI assistant degrade gracefully when no LM is available |

---

## Contributing

Contributions are welcome! Please open an issue or submit a pull request if you'd like to help make Git Atlas even better.
