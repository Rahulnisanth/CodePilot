<div align="center">

# CodeBrainPro

**AI-powered developer work-log, commit classifier, and report generator for VS Code**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/Rahulnisanth/CodeBrainPro)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.96.0-blue?logo=visual-studio-code)](https://code.visualstudio.com)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript)](https://www.typescriptlang.org)

</div>

---

## What is CodeBrainPro?

**CodeBrainPro** silently watches your coding activity, classifies your commits using Google Gemini AI, groups related work into logical tasks, and turns everything into professional reports - daily summaries, weekly logs, and appraisal documents without any manual effort.

---

## Features

| Feature                      | Description                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| **Live Activity Tracking**   | Tracks edits and focus events in real time across all Git repos                              |
| **AI Commit Classification** | Classifies commits as `feature`, `bugfix`, `refactor`, `docs`, `test`, or `chore` via Gemini |
| **Smart Work Unit Grouping** | Clusters related commits into named logical tasks automatically                              |
| **Report Generator**         | Daily / Weekly / Monthly / Appraisal reports with AI-written narratives                      |
| **Natural Language Q&A**     | Ask questions like _"What did I work on this week?"_ directly in VS Code                     |
| **Multi-Repo Support**       | Tracks all workspace folders and additional configured repo paths simultaneously             |
| **Risk Detector**            | Warns when uncommitted changes grow large or stale                                           |
| **GitHub Sync**              | Optionally pushes structured logs to a centralized `code-brain-pro-logs` GitHub repo         |
| **Secure Credentials**       | GitHub PAT and Gemini API key stored in VS Code Secret Storage — never in plaintext          |

---

## Installation

### From VSIX (Current)

1. Download the `.vsix` from [GitHub Releases](https://github.com/Rahulnisanth/CodeBrainPro/releases)
2. In VS Code: `Cmd+Shift+P` → **Extensions: Install from VSIX...**
3. Select the file and reload

### Requirements

- VS Code `^1.96.0`
- A Git repository open in your workspace

---

## Quick Setup

### 1. Add GitHub Credentials _(for sync)_

Run any sync action (`CodeBrainPro: Sync to GitHub Now`) and you'll be prompted for:

- Your **GitHub username**
- A **GitHub PAT** with `repo` scope → [create one here](https://github.com/settings/tokens)

Credentials are stored securely in VS Code Secret Storage.

### 2. Add Gemini API Key _(for AI features)_

Run any AI feature (e.g. generate a report) and you'll be prompted for a Gemini key → [get one here](https://aistudio.google.com/apikey)

> Without a Gemini key, CodeBrainPro still works — commit classification falls back to keyword matching and reports are generated without AI narratives.

---

## The Interface

### Status Bar

```text
⏱ CodeBrainPro: 4h 32m active today
```

Click to open the sidebar. Turns **amber** when uncommitted change risks are detected.

### Sidebar

```text
CODE BRAIN PRO
├── 📅 Today's Activity
│   ├── Active Time: 4h 32m
│   ├── Commits Today: 7
│   └── Repos: my-project, backend-api
├── 📦 Work Units (This Week)
│   ├── 🟢 Auth System Refactor    [feature]
│   ├── 🔴 Fix null pointer login  [bugfix]
│   └── 🔵 Clean up API types      [refactor]
├── ⚠️ Risks
│   └── my-project: 78 lines uncommitted (1h 20m)
└── 📊 Reports
    ├── Generate Daily Report
    ├── Generate Weekly Report
    ├── Generate Monthly Report
    ├── Generate Appraisal Report
    └── Ask a Question...
```

---

## Commands

Open with `Cmd+Shift+P` → type `CodeBrainPro:`

| Command                                   | Description                   |
| ----------------------------------------- | ----------------------------- |
| `CodeBrainPro: Start Tracking`            | Begin tracking                |
| `CodeBrainPro: Stop Tracking`             | Pause tracking                |
| `CodeBrainPro: Generate Daily Report`     | Last 24 hours                 |
| `CodeBrainPro: Generate Weekly Report`    | Last 7 days                   |
| `CodeBrainPro: Generate Monthly Report`   | Last 30 days                  |
| `CodeBrainPro: Generate Appraisal Report` | Custom date range             |
| `CodeBrainPro: Ask About My Work`         | Open AI chat panel            |
| `CodeBrainPro: Sync to GitHub Now`        | Push logs to GitHub           |
| `CodeBrainPro: View Today's Activity Log` | Open raw activity log         |
| `CodeBrainPro: Set Commit Interval`       | Change snapshot interval      |
| `CodeBrainPro: Clear Credentials`         | Wipe stored secrets           |
| `CodeBrainPro: Open Settings`             | Jump to CodeBrainPro settings |

---

## Reports

Reports are saved to `~/.codeBrainPro/reports/` and opened automatically after generation.

**Each report includes:**

- AI-generated achievement highlights (2–3 sentences, Gemini powered)
- Total active coding time and daily breakdown
- Work units with type labels and commit counts
- Repository breakdown (time + commits per repo)
- Top 10 most edited files
- Risk flags for the period

**Appraisal example:**

```text
Cmd+Shift+P → CodeBrainPro: Generate Appraisal Report
Start date: 2026-01-01
End date:   2026-03-31
```

---

## Settings

| Setting                             | Default | Description               |
| ----------------------------------- | ------- | ------------------------- |
| `codeBrainPro.enabled`              | `true`  | Enable/disable tracking   |
| `codeBrainPro.idleThresholdMinutes` | `5`     | Inactivity before idle    |
| `codeBrainPro.riskThresholdLines`   | `50`    | Lines before risk alert   |
| `codeBrainPro.riskThresholdMinutes` | `60`    | Minutes before risk alert |
| `codeBrainPro.additionalRepoPaths`  | `[]`    | Extra repos to track      |
| `codeBrainPro.syncEnabled`          | `false` | Auto-sync to GitHub       |
| `codeBrainPro.syncFrequencyHours`   | `24`    | Sync frequency            |
| `codeBrainPro.logRetentionDays`     | `90`    | Local log retention       |

> Secrets (`codeBrainPro.githubToken`, `codeBrainPro.geminiApiKey`) are stored via VS Code Secret Storage — never in settings files.

---

## Privacy & Security

- **Source code** — never transmitted anywhere
- **Commit messages + diff stats** — sent to Gemini API for classification (opt-in via key)
- **GitHub PAT + Gemini key** — stored in VS Code Secret Storage only
- **Activity logs** — stored locally at `~/.codeBrainPro/`, optionally synced to GitHub if enabled

---

## Local Data Layout

```text
~/.codeBrainPro/
├── logs/               ← Daily activity event files (JSON)
├── reports/            ← Generated reports (Markdown / JSON)
├── classifier-cache.json
├── seen-commits.json
└── risks.json
```

---

## Contributing

1. Fork the repository
2. Clone: `git clone https://github.com/Rahulnisanth/CodeBrainPro.git`
3. Install deps: `npm install`
4. Build: `npm run compile`
5. Press **F5** in VS Code to launch the Extension Development Host
6. Submit a pull request

---

## Documentation

- [User Guide](docs/guide.md) — full feature walkthrough
- [Product Requirements](docs/requirement.md) — architecture and spec

---

## License

MIT © [Rahulnisanth](https://github.com/Rahulnisanth/CodeBrainPro)
