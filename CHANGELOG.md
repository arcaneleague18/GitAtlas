# Changelog

All notable changes to the "git-atlas" extension will be documented in this file.

## [0.1.5] - 2026-09-04
### Added
- **Pull Button:** Added a dedicated pull from remote button in the toolbar to pull changes from the remote repository.

## [0.1.4] - 2026-09-01
### Added
- **Directory Purging:** The "Purge from History" feature now recursively supports entire folders/directories, completely removing them from all commits in the repository.

### Fixed
- Fixed a bug where purging files or folders with spaces in their names (e.g. `uml diagrams`) would silently fail and spin indefinitely because the path wasn't quoted correctly in the underlying `filter-branch` command.

## [0.1.3] - 2026-08-31
### Added
- **Command Previews:** View the exact Git commands that will be executed for actions like Push, Force Push, Merge, and Commit Rewording before confirming. Now one can also learn commands while using this.
- **Disabled Reason Tooltips:** Added contextual tooltips explaining why a button is disabled when hovering over grayed-out buttons across the interface (Toolbar, Node Inspector, Action Menu).
- **Custom Merge Messages:** Added the ability to specify a custom commit message when performing a Merge action via the Action Preview panel.

### Fixed
- Fixed an issue where cancelling a destructive history action (like Purge from History) would block the button from being used again.
- Fixed denial looping for AI assistant.
- **Commit Guardrails:** The primary commit button in the working directory view is now disabled if 0 files are staged, preventing accidental commits.
- Fixed an issue where diff stats and file lists were not displaying for merge commits (updated `diff-tree` to use `--first-parent`).

## [0.1.2] - 2026-08-26
### Added
- Added native support for the `lm-proxy` AI provider.
- Added configuration guide for Antigravity IDE users regarding `vscode.lm` and `lm-proxy`.

### Fixed
- Fixed trailing slash bug when providing a custom AI API Base URL.

## [0.1.1] - 2026-08-24
### Added
- Automated deployment to both VS Code Marketplace and Open VSX Registry.

### Changed
- Converted relative SVG images to absolute GitHub URLs to fix rendering issues in the marketplace.

## [0.1.0] - Initial Release
- Interactive, time-traveling Git tree graph view.
- Built-in Agentic AI Assistant for executing complex repository commands.
- View branch topology, switch branches, and create tags visually.
