# Changelog

## 1.0.1 (2026-04-23)

- **fix:** Update VS Code version requirement to ^1.115.0

## 1.0.2 (2026-04-23)

- **patch:** Update new extension icon

## 1.0.3 (2026-04-28)

- **docs:** Clarify GitHub PAT requirement to use Classic token with all repo scopes in README and User Guide
- **fix:** Update credential prompt text and placeholder in `src/auth/credentials.ts` to specify GitHub Personal Access Token (Classic) with all repo scopes

## 1.0.4 (2026-04-28)

- **fix:** Bug fixes and performance improvments

## 1.0.5 (2026-04-29)

### Bug Fixes

- **fix:** Active time no longer resets to 0 on VS Code window refresh — session minutes are now persisted to `~/.codeBrainPro/sidebar-active-time.json` and restored on activation

### Refactor

- **refactor:** Centralized all magic numbers, file paths, prompt strings, and icon/emoji maps into a single `src/constants.ts` module
- **refactor:** Consolidated scattered interface definitions (`CommitInfo`, `GroupResult`, `ReportData`, `RepoMetadata`, `PersistedActiveTime`) into `src/types.ts`
- **refactor:** Removed inline constants from `gitClient.ts`, `classifier.ts`, `grouper.ts`, `riskDetector.ts`, `githubSync.ts`, `sidebarProvider.ts`, `sidebarState.ts`, `reportBuilder.ts`, `markdownExporter.ts`, `secrets.ts`, `storage.ts`, and `promptTemplates.ts` in favour of shared imports
- **refactor:** Removed section-divider comments from `sessionManager.ts` and `sidebarState.ts`

## 1.0.6 (2026-04-29)

- **fix:** Resolved active time still resetting on refresh — root cause was a circular dependency between `constants.ts` and `storage.ts` that silently broke persistence file resolution
- **fix:** Risk status now correctly reflected in the sidebar — `RiskDetector` exposes detected risks via `getActiveRisks()` and the extension callback feeds them to `SidebarStateManager` before refreshing
- **fix:** Reports no longer show 0 lines changed — added `getCommitLineChanges()` to `GitClient` (uses `git show --numstat`) and `CommitPoller` now populates real `linesAdded`/`linesRemoved` values
- **fix:** "Commits Today" count now filters by today's date instead of showing all recent commits (which could span up to 7 days)
- **fix:** Updated `jsonExporter.ts` import to use centralized `ReportData` from `types.ts`

## 1.0.7 (2026-04-30)

### Removed

- **breaking:** Removed the **Status Bar** widget (`src/ui/statusBarItem.ts`) — the live active-time indicator and risk-amber background are no longer present
- **breaking:** Removed the **Risk Detector** module (`src/git/riskDetector.ts`) — uncommitted-change warnings, risk notifications, and `risks.json` logging are no longer generated
- **breaking:** Removed the **Today's Activity** sidebar section — active time, commits today, and repos list are no longer displayed
- **breaking:** Removed the **Risks** sidebar section — risk items no longer appear in the sidebar tree

### Sidebar (Now)

The sidebar now shows only two sections:

```text
CODE BRAIN PRO
├── 📦 Work Units (This Week)
└── 📊 Reports
```

### Docs

- Updated `README.md`, `docs/guide.md`, and `docs/requirement.md` to reflect all removals

## 1.0.8 (2026-05-09)

- **fix:** Chat panel send button no longer stays permanently disabled after an error — `isWaiting` is now reset and the button re-enabled inside the `'history'` message handler (which is the only message type the backend ever posts), so users can send follow-up messages without reopening the panel
- **fix:** GitHub sync no longer fails with a 404 error on first use — after `auto_init` repo creation, the sync engine now polls the Contents API with exponential back-off (`waitForRepoReady`) until the default branch is ready before pushing; additionally, the SHA-fetch error handler now only silently ignores true 404s (file not yet created) and surfaces all other errors (auth failures, rate limits, etc.)

## 1.0.9 (2026-05-09)

- **fix:** Chat panel's send button no longer stays permanently disabled after single message and the button is re-enabled inside the `'history'` message handler

## 1.2.0 (2026-05-09)

- **feat** Added new sidebar icon and updated the file structure of UIs
