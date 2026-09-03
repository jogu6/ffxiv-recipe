# Lodestone Update Monitor

The update monitor checks the Lodestone item and recipe-list metadata every day. A successful check with no new data is silent. When a change is found, the monitor runs a complete resumable audit and the existing data pipeline, updates the public data and service-worker cache identifiers, validates the repository, commits and pushes the allowed public files, and waits for the matching GitHub Pages workflow run. Successful and failed update runs send a Japanese Discord notification. The automation uses Node.js, Git, and GitHub CLI only; it does not call Codex or any AI API.

The hidden monitor process and every child process run at below-normal CPU priority. Generated-data Node.js processes use a bounded heap, external reads are sequential, compressed source pages are released after use, and full HTML collections are not retained in memory. Git and GitHub authentication is explicitly non-interactive, so an expired credential fails without opening a terminal, browser, or credential dialog.

## Monitored values

- Lodestone Version
- Total item count
- Total recipe count
- Item-order signature

The full descending item list is read only when the Version or total item count differs from the saved state. When both are unchanged, the saved item-order signature is reused. The first successful run saves a baseline without sending a notification. A detected update starts a fresh sequential audit of every planned item-list page, recipe-list page, and recipe-detail page. Each completed resource is recorded durably, an interrupted audit resumes without replacing completed resources, and partial audit results are never promoted or published.

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

Authentication failures, source access failures, HTML extraction failures, generation or validation failures, unexpected Git changes, push failures, and deployment failures produce a Japanese Discord message with a predefined recovery action. Authentication messages include the manual reauthentication commands. When a log must be inspected, the message includes its absolute path. If the Discord webhook itself is unavailable, the same recovery advice is retained in the run log.

## Task Scheduler

The registered task is named `xivapi-update-monitor-task`. The legacy name and entry point are retained for compatibility, but the implementation monitors Lodestone. The task launches through `wscript.exe` without showing a window and runs daily under the configured Windows account.

The compatibility entry point is:

```powershell
node pipeline/tool/xivapi-update-monitor.mjs
```

## Test notification

```powershell
node pipeline/tool/lodestone-update-monitor.mjs --test-notification
```

This does not modify the comparison baseline.

## Recovery and completion

Automatic publication starts only from a clean `main` branch synchronized with its configured remote. State records every completed pipeline command and the commit/push/deployment phases. A later scheduled run resumes after the last completed command instead of repeating successful long-running work. Generated changes are restricted to the approved public data, icon pack, application cache identifier, and service worker files. Unexpected files stop publication.

If generated public data is unchanged, the run finishes successfully without an empty commit or deployment. If files changed, the automation commits them, pushes once, waits for the workflow run whose commit SHA exactly matches the pushed commit, and reports the deployment result.

## Log archives

The monitor invokes the shared log-archive routine at startup. Logs from a completed month are written to a verified monthly ZIP before their source files and archived monitor lines are removed. Monthly ZIP files from a completed year are embedded in a verified yearly ZIP and then removed. Repeated runs are idempotent. Month and year boundaries are evaluated in JST.

## Local files

- State: `pipeline/state/lodestone-monitor.json`
- Automatic publication state: `pipeline/state/auto-publish.json`
- Log: `pipeline/logs/lodestone-monitor.txt`
- Automatic publication runs: `pipeline/logs/runs/*-auto-publish.log`

All persisted and displayed timestamps use JST in `YYYY-MM-DDTHH:mm:ss.sss+09:00` format.
