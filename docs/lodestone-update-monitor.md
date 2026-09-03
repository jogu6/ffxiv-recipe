# Lodestone Update Monitor

The update monitor checks the Lodestone item and recipe list metadata every day. A successful check with no new data is silent. When a change is found, the monitor runs the existing data pipeline, updates the public data and service-worker cache identifiers, validates the repository, commits and pushes the allowed public files, and waits for the matching GitHub Pages workflow run. The automation uses Node.js, Git, and GitHub CLI only; it does not call Codex or any AI API.

The monitor process and every child process run at below-normal CPU priority. Generated-data Node.js processes also use a bounded heap so the unattended background task does not compete aggressively with interactive work.

## Monitored values

- Lodestone Version
- Total item count
- Total recipe count
- Item-order signature

The full descending item list is read only when the Version or total item count differs from the saved state. When both are unchanged, the saved item-order signature is reused. The first successful run saves a baseline without sending a notification.

## Discord configuration

Copy `pipeline/config/lodestone-monitor.example.json` to `pipeline/config/lodestone-monitor.local.json` and set the webhook URL:

```json
{
  "discordWebhookUrl": "https://discord.com/api/webhooks/ID/TOKEN",
  "delayMs": 100,
  "autoPublish": {
    "enabled": true,
    "remote": "origin",
    "branch": "main",
    "deployWorkflow": "deploy-pages.yml",
    "deployTimeoutMinutes": 20,
    "deployPollSeconds": 15,
    "iconQuality": 80,
    "iconSize": 80
  }
}
```

The local file is ignored by Git. Keep the webhook URL secret because anyone with the URL can post through it.

The values shown under `autoPublish` are the defaults. The automation requires a clean `main` branch synchronized with `origin/main`. It commits only the public item documents, item icon pack, `site/app.js`, and `site/sw.js`. Unexpected changes stop the run without overwriting existing work.

Authenticate Git and GitHub CLI once for the Windows account used by Task Scheduler:

```powershell
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
gh auth status
```

Authentication failures, source access failures, HTML extraction failures, generation or validation failures, unexpected Git changes, push failures, and deployment failures produce a Japanese Discord message with a predefined recovery action. If the Discord webhook itself is unavailable, the same recovery advice is retained in the local run log.

## Task Scheduler

Run this command from the existing hidden Windows Task Scheduler wrapper:

```powershell
node pipeline/tool/lodestone-update-monitor.mjs
```

## Test notification

```powershell
node pipeline/tool/lodestone-update-monitor.mjs --test-notification
```

This does not modify the comparison baseline.

## Local files

- State: `pipeline/state/lodestone-monitor.json`
- Automatic publication state: `pipeline/state/auto-publish.json`
- Log: `pipeline/logs/lodestone-monitor.txt`
- Automatic publication runs: `pipeline/logs/runs/*-auto-publish.log`

Log timestamps use JST in `YYYY-MM-DDTHH:mm:ss.sss+09:00` format.
