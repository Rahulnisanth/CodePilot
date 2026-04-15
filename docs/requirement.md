# Auto-Commit Mate++ — Product Requirements

> **Product:** Auto-Commit Mate++ (ACM)
> **Version:** 1.0.0
> **Publisher:** Rahulnisanth
> **Last Updated:** 2026-04-13

---

## 1. Overview

**Auto-Commit Mate++** is a VS Code extension that automatically tracks, summarizes, and reports what you worked on — without any manual logging effort.

It hooks into your coding activity in real time, classifies your commits using Google Gemini AI, groups related work into logical units, and generates professional reports you can use in standups, appraisals, or performance reviews.

**Core value proposition:**

> _"You code. ACM++ tells your story."_

---

## 2. Tech Stack

| Layer           | Technology                                                         |
| --------------- | ------------------------------------------------------------------ |
| Language        | TypeScript                                                         |
| Runtime         | Node.js ≥ 18.x (in-process within extension)                       |
| Extension API   | VS Code `^1.96.0`                                                  |
| AI / LLM        | Google Gemini API (`gemini-2.5-flash`) via `@google/generative-ai` |
| Version Control | Git CLI via `child_process.exec` (async, non-blocking)             |
| Remote Sync     | GitHub REST API v3 via `axios`                                     |
| Auth Storage    | VS Code Secret Storage (`context.secrets`)                         |
| Local Storage   | Structured JSON files in `~/.acm/`                                 |
| Report Export   | Markdown (built-in), JSON                                          |
| Build           | `esbuild` (fast bundler)                                           |
| Type Checking   | TypeScript strict mode                                             |

---

## 3. Architecture

### Project Structure

```
src/
├── extension.ts              # Entry point — activate/deactivate
├── types.ts                  # Shared data models
├── tracker/
│   ├── activityTracker.ts    # vscode event hooks (document changes, focus)
│   ├── sessionManager.ts     # Session boundary detection
│   └── logWriter.ts          # Write events to ~/.acm/logs/
├── git/
│   ├── gitClient.ts          # Async git command wrappers
│   ├── commitPoller.ts       # 5-min commit detection interval
│   └── riskDetector.ts       # Uncommitted change warnings
├── ai/
│   ├── classifier.ts         # Gemini commit classification
│   ├── grouper.ts            # WorkUnit clustering
│   ├── reporter.ts           # AI narrative generation
│   └── promptTemplates.ts    # All Gemini prompts
├── repos/
│   └── repoManager.ts        # Multi-workspace repo detection
├── reports/
│   ├── reportBuilder.ts      # Aggregates events → ReportData
│   ├── reportManager.ts      # Orchestrates report generation
│   └── exporters/
│       ├── markdownExporter.ts
│       └── jsonExporter.ts
├── sync/
│   └── githubSync.ts         # Push logs/reports to GitHub
├── auth/
│   └── credentials.ts        # GitHub PAT + Gemini key via SecretStorage
├── ui/
│   ├── statusBarItem.ts      # Live status bar widget
│   ├── sidebarProvider.ts    # VS Code TreeDataProvider
│   └── chatPanel.ts          # Natural language Q&A webview
└── utils/
    ├── uuid.ts               # UUID generation (Node crypto)
    ├── dateUtils.ts          # Date/time formatting helpers
    ├── storage.ts            # ~/.acm/ read/write helpers
    └── secrets.ts            # context.secrets abstraction
```

---

## 4. Core Modules

### 4.1 Activity Tracker (`src/tracker/`)

Captures all developer activity in real time by hooking into VS Code event APIs.

**Events captured:**

| Event        | Hook                                        | Data recorded                                                       |
| ------------ | ------------------------------------------- | ------------------------------------------------------------------- |
| File edit    | `vscode.workspace.onDidChangeTextDocument`  | `filePath`, `linesAdded`, `linesRemoved`, `languageId`, `timestamp` |
| Editor focus | `vscode.window.onDidChangeActiveTextEditor` | `filePath`, `languageId`, `timestamp`                               |
| Idle         | Timer (every 30s)                           | Marks session boundary after `idleThresholdMinutes` of no activity  |

**Session management:**

- A `WorkSession` is the unit of active coding time between two idle boundaries
- `SessionManager` tracks active sessions per repo and computes `activeMinutes`
- All intervals are registered via `context.subscriptions` for clean deactivation

**Storage:**

- `LogWriter` appends `ActivityEvent` objects to `~/.acm/logs/YYYY-MM-DD.json`
- Log rotation: files older than `acm.logRetentionDays` (default: 90) are deleted automatically

**Data shape (ActivityEvent):**

```typescript
interface ActivityEvent {
  eventId: string; // UUID v4
  type: 'edit' | 'focus' | 'idle' | 'commit';
  filePath: string;
  repoRoot: string;
  repoName: string;
  timestamp: string; // ISO 8601
  linesAdded: number;
  linesRemoved: number;
  languageId: string;
  sessionId: string;
}
```

---

### 4.2 Git Integration Engine (`src/git/`)

All git operations are fully async — no blocking calls.

**Git commands used:**

```bash
git rev-parse --is-inside-work-tree     # repo detection
git rev-parse --show-toplevel           # repo root
git remote get-url origin               # remote URL
git diff --stat                         # unstaged changes
git diff --cached --stat                # staged changes
git diff --numstat                      # line counts
git log --oneline --since="..." --pretty=format:"%H|%s|%an|%ad" --date=iso
git status --porcelain                  # uncommitted file status
git log -1 --pretty=format:"%ad" --date=iso  # last commit time
```

**Commit Poller (`commitPoller.ts`):**

- Polls all tracked repos every 5 minutes for new commits
- Persists seen commit hashes across restarts in `~/.acm/seen-commits.json`
- Emits `CommitRecord` events to registered listeners

**Risk Detector (`riskDetector.ts`):**

- Polls all repos every 10 minutes
- Triggers a VS Code warning notification when:
  - `≥ acm.riskThresholdLines` lines modified but uncommitted for `≥ acm.riskThresholdMinutes`
  - A file has been deleted but not committed
- Notification includes a quick-action button to open Source Control panel
- Logs risk events to `~/.acm/risks.json`
- Reports risk count to the status bar (amber indicator)

---

### 4.3 Auth Module (`src/auth/`)

All secrets are stored exclusively in VS Code Secret Storage (`context.secrets`) — never in plaintext settings or `globalState`.

| Secret          | Key                  | Storage                          |
| --------------- | -------------------- | -------------------------------- |
| GitHub PAT      | `acm.githubToken`    | `context.secrets`                |
| Gemini API Key  | `acm.geminiApiKey`   | `context.secrets`                |
| GitHub username | `acm.githubUsername` | VS Code settings (non-sensitive) |

**Flows:**

- On first use, prompts user for GitHub username + PAT via secure masked `showInputBox`
- On first AI feature use, prompts user for Gemini API key
- `acm.clearCredentials` command wipes all stored secrets and resets username

---

### 4.4 Multi-Repository Manager (`src/repos/`)

Supports tracking across multiple Git repositories simultaneously.

- Detects all repos from `vscode.workspace.workspaceFolders`
- Additionally tracks paths listed in `acm.additionalRepoPaths`
- Stores per-repo metadata: `repoName`, `repoPath`, `remoteUrl`, `lastSyncedAt`
- All activity events, commits, and reports are tagged with their source repo

---

### 4.5 AI Classification Engine (`src/ai/classifier.ts`)

Classifies each commit into a work type using Google Gemini.

**Privacy:** Only commit messages and `git diff --stat` summaries are sent — never raw source code.

**Work types:**

| Type       | Description                                |
| ---------- | ------------------------------------------ |
| `feature`  | New functionality added                    |
| `bugfix`   | Correcting a defect                        |
| `refactor` | Code restructuring without behavior change |
| `docs`     | Documentation changes                      |
| `test`     | Test additions or fixes                    |
| `chore`    | Config, deps, tooling                      |
| `unknown`  | Insufficient signal                        |

**Response shape:**

```typescript
interface ClassificationResult {
  type: WorkType;
  confidence: number; // 0.0–1.0
  summary: string; // 1 sentence
}
```

**Caching:** Results are cached by `commitHash` in `~/.acm/classifier-cache.json` to avoid redundant API calls.

**Graceful degradation:** If Gemini is unavailable or no API key is set, falls back to keyword-based rule matching:

| Keyword pattern                                                      | Classification |
| -------------------------------------------------------------------- | -------------- |
| `fix`, `bug`, `patch`, `hotfix`, `issue`, `error`, `defect`          | `bugfix`       |
| `feat`, `add`, `new`, `implement`, `create`, `introduce`             | `feature`      |
| `refactor`, `clean`, `restructure`, `rename`, `move`, `improve`      | `refactor`     |
| `doc`, `readme`, `docs`, `comment`, `changelog`                      | `docs`         |
| `test`, `spec`, `unit`, `e2e`, `coverage`                            | `test`         |
| `chore`, `dep`, `ci`, `build`, `config`, `lint`, `format`, `version` | `chore`        |

**Gemini system prompt:**

```
You are a senior software engineer analyzing Git commits.
Given a commit message and diff summary, classify the work type.
Respond ONLY with valid JSON: { "type": "<type>", "confidence": <float>, "summary": "<1 sentence>" }
Types: feature | bugfix | refactor | docs | test | chore | unknown
```

---

### 4.6 Smart Commit Grouper (`src/ai/grouper.ts`)

Groups related commits into logical `WorkUnit` objects (tasks/features).

**Grouping strategy:**

- Uses Gemini to identify semantically related commits and assign human-readable names
- E.g.: 3 commits touching `auth/`, `credentials.ts` → `"Secure Auth Migration"`
- Falls back to 4-hour time-window grouping when Gemini is unavailable
- Groups the most recent 50 commits per activation window

**WorkUnit shape:**

```typescript
interface WorkUnit {
  id: string;
  name: string; // AI-generated label
  type: WorkType;
  commits: string[]; // commit hashes
  repos: string[];
  startTime: string; // ISO 8601
  endTime: string;
  totalLinesChanged: number;
}
```

Re-groups automatically after every new commit detection.

---

### 4.7 Report Generator (`src/reports/`)

Generates professional work reports from activity data.

#### Report Types

| Report           | Scope             | Command                 |
| ---------------- | ----------------- | ----------------------- |
| Daily Summary    | Last 24 hours     | `acm.generateDaily`     |
| Weekly Work-Log  | Last 7 days       | `acm.generateWeekly`    |
| Monthly Summary  | Last 30 days      | `acm.generateMonthly`   |
| Appraisal Report | Custom date range | `acm.generateAppraisal` |

#### Report Content

Each report includes:

- **Time Summary** — Total active coding time, breakdown by day
- **Achievement Highlights** — AI-generated 2–3 sentence narrative (via Gemini)
- **Work Units** — Grouped tasks with type labels and commit counts
- **Repository Breakdown** — Time and commits per repo
- **Top Files** — Most frequently edited files
- **Risk Flags** — Any large uncommitted changes detected during the period

#### Export Formats

| Format   | File    | Status           |
| -------- | ------- | ---------------- |
| Markdown | `.md`   | Always available |
| JSON     | `.json` | Always available |

Reports are saved to `~/.acm/reports/` and opened automatically after generation.

#### Natural Language Query

A chat panel webview allows free-form questions about work history:

> _"What did I work on this week?"_
> _"How many bug fixes did I make last month?"_

Powered by Gemini. Maintains conversation context within the same session.

---

### 4.8 GitHub Sync Engine (`src/sync/`)

Optionally syncs structured activity logs to a centralized `Activity-Logger` GitHub repository.

- Auto-creates the repository if it doesn't exist (`auto_init: true`)
- Sync structure:
  - `logs/YYYY/MM/DD.json` — structured daily log (JSON)
- Configurable sync frequency via `acm.syncFrequencyHours` (default: 24h, disabled by default)
- Manual trigger: `acm.syncNow` command
- Sync status shown in status bar during sync

---

## 5. VS Code Interface

### 5.1 Status Bar

A persistent status bar item in the bottom-left:

```
⏱ ACM: 4h 32m active today
```

- Click opens the sidebar panel
- Turns **amber** when a risk is detected
- Shows a sync spinner during GitHub sync
- Updates every minute

### 5.2 Sidebar Panel

A tree view in the Activity Bar:

```
AUTO-COMMIT MATE++
├── 📅 Today's Activity
│   ├── Active Time: 4h 32m
│   ├── Commits Today: 7
│   └── Repos: ACM, backend-api
├── 📦 Work Units (This Week)
│   ├── 🟢 Secure Auth Migration  [feature]
│   ├── 🔴 Fix setInterval Leak   [bugfix]
│   └── 🔵 Migrate to TypeScript  [refactor]
├── ⚠️ Risks
│   └── ACM: 78 lines uncommitted (1h 20m)
└── 📊 Reports
    ├── Generate Daily Report
    ├── Generate Weekly Report
    ├── Generate Monthly Report
    ├── Generate Appraisal Report
    └── Ask a Question...
```

### 5.3 Commands (Command Palette)

| Command                    | ID                      |
| -------------------------- | ----------------------- |
| Start Auto-Commit Tracking | `acm.start`             |
| Stop Auto-Commit Tracking  | `acm.stop`              |
| Set Commit Interval        | `acm.setInterval`       |
| Generate Daily Report      | `acm.generateDaily`     |
| Generate Weekly Report     | `acm.generateWeekly`    |
| Generate Monthly Report    | `acm.generateMonthly`   |
| Generate Appraisal Report  | `acm.generateAppraisal` |
| Ask About My Work          | `acm.askQuestion`       |
| Sync to GitHub Now         | `acm.syncNow`           |
| View Today's Activity Log  | `acm.viewLog`           |
| Clear Credentials          | `acm.clearCredentials`  |
| Open Settings              | `acm.openSettings`      |
| Open Sidebar               | `acm.openSidebar`       |

---

## 6. Settings

| Setting                     | Type     | Default | Description                             |
| --------------------------- | -------- | ------- | --------------------------------------- |
| `acm.enabled`               | boolean  | `true`  | Enable/disable all tracking             |
| `acm.githubUsername`        | string   | `""`    | GitHub username (non-sensitive)         |
| `acm.additionalRepoPaths`   | string[] | `[]`    | Extra Git repo paths to track           |
| `acm.commitIntervalMinutes` | number   | `30`    | Auto-commit log interval (minutes)      |
| `acm.idleThresholdMinutes`  | number   | `5`     | Inactivity time before marking idle     |
| `acm.riskThresholdLines`    | number   | `50`    | Uncommitted lines to trigger risk alert |
| `acm.riskThresholdMinutes`  | number   | `60`    | Minutes before risk alert fires         |
| `acm.syncEnabled`           | boolean  | `false` | Enable auto-sync to GitHub              |
| `acm.syncFrequencyHours`    | number   | `24`    | Hours between auto-syncs                |
| `acm.logRetentionDays`      | number   | `90`    | Days to keep local activity logs        |
| `acm.showStartupPrompt`     | boolean  | `true`  | Show welcome prompt on startup          |

> **Secrets** (stored via `context.secrets`, never in settings):
>
> - `acm.githubToken` — GitHub Personal Access Token
> - `acm.geminiApiKey` — Google Gemini API key

---

## 7. Data Models

```typescript
type WorkType =
  | 'feature'
  | 'bugfix'
  | 'refactor'
  | 'docs'
  | 'test'
  | 'chore'
  | 'unknown';

interface ActivityEvent {
  eventId: string;
  type: 'edit' | 'focus' | 'idle' | 'commit';
  filePath: string;
  repoRoot: string;
  repoName: string;
  timestamp: string;
  linesAdded: number;
  linesRemoved: number;
  languageId: string;
  sessionId: string;
}

interface WorkSession {
  sessionId: string;
  repoName: string;
  repoPath: string;
  startTime: string;
  endTime: string;
  activeMinutes: number;
  idleMinutes: number;
  filesEdited: string[];
  linesAdded: number;
  linesRemoved: number;
}

interface CommitRecord {
  hash: string;
  message: string;
  author: string;
  timestamp: string;
  repoName: string;
  repoPath: string;
  filesChanged: string[];
  diffStat: string;
  linesAdded: number;
  linesRemoved: number;
  classification?: ClassificationResult;
  workUnitId?: string;
}

interface WorkUnit {
  id: string;
  name: string;
  type: WorkType;
  commits: string[];
  repos: string[];
  startTime: string;
  endTime: string;
  totalLinesChanged: number;
}

interface RiskEvent {
  timestamp: string;
  repoName: string;
  repoPath: string;
  linesChanged: number;
  minutesSinceLastCommit: number;
  hasDeletedFiles: boolean;
}

interface ClassificationResult {
  type: WorkType;
  confidence: number;
  summary: string;
}
```

---

## 8. Local File System Layout

```
~/.acm/
├── logs/
│   ├── 2026-04-13.json      # Daily activity events
│   ├── 2026-04-12.json
│   └── ...
├── reports/
│   ├── 2026-04-13-daily.md
│   ├── 2026-W15-weekly.md
│   └── ...
├── classifier-cache.json    # Commit classification cache (keyed by hash)
├── seen-commits.json        # Commit poll deduplication state
└── risks.json               # Risk event log
```

---

## 9. Non-Functional Requirements

| Requirement               | Target                                                                  |
| ------------------------- | ----------------------------------------------------------------------- |
| Extension activation time | < 500ms                                                                 |
| Background CPU usage      | < 2% average                                                            |
| Local storage per month   | < 10 MB                                                                 |
| AI API call latency       | < 5s per classification (with loading state)                            |
| Offline mode              | All tracking and sync works; AI degrades gracefully to keyword fallback |
| Privacy                   | No source code sent to any API — only commit messages and diff stats    |
| Security                  | All credentials stored exclusively in VS Code Secret Storage            |
| VS Code version           | `^1.96.0`                                                               |
| Node.js version           | `≥ 18.x`                                                                |

---

## 10. Roadmap

| Phase | Feature                                                             |
| ----- | ------------------------------------------------------------------- |
| 1.1   | VS Code Webview dashboard — activity heatmap, work-type pie chart   |
| 1.2   | Slack / Teams webhook — automated weekly team reports               |
| 1.3   | Jira / Linear ticket linking — match commit keywords to ticket IDs  |
| 1.4   | Team mode — aggregate work logs across a team repo                  |
| 1.5   | Local LLM support (Ollama) as a privacy-first alternative to Gemini |

---

## 11. Out of Scope

- Real-time collaboration or live sharing
- Billing or client time-tracking (no invoice generation)
- Code quality analysis or linting suggestions
- Modifying or rewriting commit messages automatically
- Any raw source code leaving the machine
