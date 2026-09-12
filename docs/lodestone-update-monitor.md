# Lodestone Update Monitor

The update monitor checks the Lodestone item and recipe-list metadata every day. A successful check with no new data is silent. When an unapplied change is found, the monitor runs a complete resumable audit and the existing data pipeline, updates the public data and service-worker cache identifiers, validates the repository, commits and pushes the allowed public files, and waits for the matching GitHub Pages workflow run. Successful and failed update runs send a Japanese Discord notification. The automation uses Node.js, Git, and GitHub CLI only; it does not call Codex or any AI API.

The hidden monitor process and every child process run at below-normal CPU priority. Generated-data Node.js processes use a bounded heap, external reads are sequential, compressed source pages are released after use, and full HTML collections are not retained in memory. Git and GitHub authentication is explicitly non-interactive, so an expired credential fails without opening a terminal, browser, or credential dialog.

## Monitored values

- Lodestone Version
- Recipe-list Version
- Total item count
- Total recipe count
- Item-order signature

The full descending item list is read only when neither the saved monitor state nor the verified applied-data record matches the current Version and total item count. When changed metadata already establishes an update against an initialized baseline, this full scan is deferred to the audit instead of being performed twice. The deferred signature stays unknown until a verified publication receipt supplies it; it is never treated as an unchanged catalog. Otherwise the matching item-order signature is reused. The first successful run saves a baseline without sending a notification. An unapplied update starts a fresh sequential audit of every planned item-list page, recipe-list page, and recipe-detail page. Each completed resource is recorded durably, an interrupted audit resumes without replacing completed resources, and partial audit results are never promoted or published.

Candidate generation preserves existing item fields and additional document metadata, including equipment, gathering, vendor ranks, and icons, while rebuilding source-owned recipe and ordering data. Name aliases carry existing fields across renames. Newly added items reuse their item-detail page from the same completed audit when available. Before publication, preservation checks reject missing required items or fields. Items no longer needed by the audited recipes and configured exchanges are explicitly recorded as retired; after validating all remaining icon references, unused image files are removed.

After `publish-lodestone-candidate` finishes successfully, both manual and automatic runs save a local applied-data record containing the source metadata, audit identity, data generation, and the SHA-256 of `Item.json`. The monitor verifies the actual file against this record. If the source metadata is already applied, it synchronizes its baseline without crawling the full item list, regenerating data, running Git preflight, or sending a publication notification. A version number or file timestamp alone never establishes that an update is applied. Candidate generation alone does not create this record.

Applied data and completed deployment remain separate states. An outstanding automatic generation, commit, or push is still routed through publication recovery, even when the monitor baseline is unchanged. In particular, a committed or pushed update resumes its remaining publication steps. A manual data update never marks a deployment successful. Failed or disabled publication leaves the comparison baseline unchanged so a later run can retry.

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

The values shown under `autoPublish` are the defaults. The automation publishes to `main`, whose HEAD must match `origin/main` before a new update begins. Uncommitted changes, including staged edits, are allowed. The commit contains only changed public item documents and the item icon pack, plus the `DATA_CACHE_VERSION` lines in `site/app.js` and `site/sw.js`, the `PACK_VERSION` line in `site/item-icon-pack.js`, and the recalculated `APP_CACHE_VERSION` line in `site/sw.js`. Other edits in those files and elsewhere remain local.

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

Automatic publication starts from `main` synchronized with its configured remote; unresolved merge conflicts still prevent publication. It builds a temporary checkout and index from HEAD, copies only the generated data and named constants, and recalculates the application cache identifier from the exact assets being committed. The candidate site's validator and JavaScript syntax checks run against this checkout, so unfinished local application edits do not enter validation or publication. The original index retains unrelated staged changes, including edits elsewhere in the same JavaScript files.

State records completed pipeline commands and the commit/push/deployment phases. Before generation, the public files are backed up locally. A failed generation or validation restores these files without resetting the index. A later run reuses completed audit and download stages but repeats publication stages whose output was rolled back. The commit journal permits recovery when interruption occurs between updating `main` and recording the completed commit. Resolving a deferred item-order signature does not prevent recovery of the saved commit for the same source version and counts.

If generated public data is unchanged, the run finishes successfully without an empty commit or deployment. If files changed, the automation commits them to `main`, pushes the saved commit SHA explicitly to `refs/heads/main`, waits for the workflow run whose commit SHA exactly matches the pushed commit, and reports the deployment result. A retry never pushes later, unrelated local commits through `HEAD`.

## Log archives

The monitor invokes the shared log-archive routine at startup. Logs from a completed month are written to a verified monthly ZIP before their source files and archived monitor lines are removed. Monthly ZIP files from a completed year are embedded in a verified yearly ZIP and then removed. Repeated runs are idempotent. Month and year boundaries are evaluated in JST.

## Local files

- State: `pipeline/state/lodestone-monitor.json`
- Applied-data record: `pipeline/state/lodestone-applied.json`
- Automatic publication state: `pipeline/state/auto-publish.json`
- Automatic publication backups and temporary indexes: `pipeline/state/auto-publish-files-*/`
- Log: `pipeline/logs/lodestone-monitor.txt`
- Automatic publication runs: `pipeline/logs/runs/*-auto-publish.log`

All persisted and displayed timestamps use JST in `YYYY-MM-DDTHH:mm:ss.sss+09:00` format.
