# Changelog

All notable changes to the "git-atlas" extension will be documented in this file.

## [0.1.3] - 2026-08-29
### Added
- **Command Previews:** View the exact Git commands that will be executed for actions like Push, Force Push, Merge, and Commit Rewording before confirming. Now one can also learn commands while using this.

### Fixed
- Fixed an issue where cancelling a destructive history action (like Purge from History) would block the button from being used again.
- **Commit Guardrails:** The primary commit button in the working directory view is now disabled if 0 files are staged, preventing accidental commits.

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
