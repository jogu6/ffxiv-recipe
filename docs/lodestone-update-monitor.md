# Lodestone Update Monitor

The update monitor compares every Lodestone recipe-list page with the HTML from the last successfully applied full audit on each scheduled run. A successful check with no new data is silent. When an unapplied change is found, the monitor runs the appropriate full-audit, acquisition-only, or quality-only data pipeline, updates the public data and service-worker cache identifiers, validates the repository, commits and pushes the allowed public files, and waits for the matching GitHub Pages workflow run. Successful and failed update runs send a Japanese completion or failure notification. The automation uses Node.js, Git, and GitHub CLI only; it does not call Codex or any AI API.

The hidden monitor process and every child process run at below-normal CPU priority. Generated-data Node.js processes use a bounded heap, external reads are sequential, compressed source pages are released after use, and full HTML collections are not retained in memory. Git and GitHub authentication is explicitly non-interactive, so an expired credential fails without opening a terminal, browser, or credential dialog.

## Recipe-list comparison

The monitor reads the recipe list sequentially, one page at a time, and compares its contents directly with the saved HTML. It checks the recipe version, total count, page count, row order, recipe names and IDs, crafting jobs, visible table cells (including levels), and icon paths. Changes to surrounding news, rankings, whitespace, or icon cache-query strings do not count as recipe changes. It does not use HTML hashes to decide whether the list changed.

When all recipe-list pages match, the scheduled check ends without requesting recipe details, item details, shop inventories or gathering pages. Cache expiration alone does not start an update. A difference starts the existing full-audit and candidate-generation pipeline. It parses minimum completion quality for every audited recipe, including ordinary NQ-only recipes, so an added, changed or removed requirement is reflected in that update. The regular check cannot detect detail-only changes that leave every recipe-list field unchanged.

During an update, recently checked recipe HTML in the shared cache is reused with its original fetch timestamp. Cached HTML is reused for up to one hour across comparison, generation and retries. Expired, malformed, version-inconsistent or incomplete pages are refreshed when an update needs them. Full audits reuse recently checked recipe pages while fetching their catalog lists fresh. Acquisition generation reads each official shop inventory once and indexes its sales and exchanges by item, then obtains required gathering information. It retains unconditional manual-only vendors and missing-field supplements.

Previously recorded acquisition-only and quality-only publication journals remain resumable. Quality-only candidate generation retains other public fields and legacy mappings and skips catalog audits, gathering/shop crawls and icon generation. Later regular candidate generation consults newer quality HTML when necessary so an older audit cannot revert a published correction.

Each detected change receives a new publication-run ID. Matching versions, counts, old publication receipts, and completed generation stages cannot suppress that run. For changes requiring a full audit, the `lodestone-audit --fresh` step starts a new audit even if a matching interrupted audit exists. Quality-only updates skip that step. Manual audits retain their default resumable behavior. A committed or pushed automatic update still completes its recorded publication steps before the monitor checks for another source change.

The comparison cache is a small manifest pointing to immutable, compressed HTML for each ending recipe-list page in the successfully applied audit. On migration, a verified applied-data record and its completed audit supply the initial cache without network reads. After automatic publication succeeds, the manifest is atomically replaced using that run's verified applied audit. Failed or disabled publication retains the previous comparison baseline. Missing or damaged HTML, incomplete rows, parsing failures, and HTTP failures are check failures, never an unchanged result. If no applied baseline exists, a successful initial source read triggers the normal pipeline to establish it.

Recipe comparison detects changes visible in the recipe list. Detail fields, including completion quality, ingredient quantities, exchange costs and gathering levels, are refreshed after a detected update; they are not independently polled on unchanged scheduled runs. A maintenance page or failed list request is a failed check, never an unchanged result.

Candidate generation preserves equipment, icons, and additional document metadata while rebuilding source-owned recipes, ordering, gathering, and shops. Acquisition generation checks official gathering-detail pages and vendor pages, including folklore requirements, maps, local place names, gil prices, coordinates, and purchase conditions. Conditional vendors are excluded. Confirmed official gathering fields take precedence; missing or hidden fields fall back to manual supplements, including maps needed to retain ET schedules and unpublished technical requirements. The shared fallback applies to every automatic generation, so hidden official locations cannot erase manually recorded timed gathering. Name aliases carry existing fields across renames. Before publication, preservation checks reject missing required items or opaque fields. Items no longer needed by the audited recipes and configured exchanges are explicitly recorded as retired; after validating all remaining icon references, unused image files are removed.

After `publish-lodestone-candidate` finishes successfully, both manual and automatic runs save a local applied-data record containing the source metadata, audit identity, data generation, and the SHA-256 of `Item.json`. File and artifact hashes verify integrity; they are not the recipe-list change detector. Candidate generation alone does not create this record. Comparison baseline promotion follows successful automatic publication, so a failed deployment does not mark the source comparison complete.

## Configuration and authentication

The monitor's deployment configuration controls the request interval, notifications, and automatic publication. Credentials are stored separately from published application assets. Shop comparison and candidate generation both merge unconditional manual-only gil vendors from `gil-shop-supplements.json`; official prices take precedence and confirmed conditional vendors are excluded, so subsequent updates retain eligible fallback shops.

Automatic publication defaults to enabled, with remote `origin`, branch `main`, deployment workflow `deploy-pages.yml`, a 20-minute deployment timeout, 15-second polling, and image quality and size both set to 80. The default request interval is 100 milliseconds.

The branch must match its remote before a new update begins. Uncommitted changes, including staged edits, are allowed. The commit includes only the generated public item documents and image pack, the data-cache and pack-version constants, and the recalculated application-cache identifier. Other edits remain in the working tree and index.

Authenticate Git and GitHub CLI for the Windows account used by the scheduled task:

```powershell
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
gh auth status
```

Scheduled execution runs without a visible window. Authentication, source access, extraction, generation, validation, push, and deployment failures produce a Japanese notification with recovery guidance. If notification delivery fails, the same guidance remains in the run log. The notification-test option sends a test message without changing the source-comparison baseline.

## Recovery and completion

Automatic publication starts from `main` synchronized with its configured remote; unresolved merge conflicts still prevent publication. It builds a temporary checkout and index from HEAD and copies only the generated data and named constants into the publication files. Data-only validation checks item names, recipe references, equipment fields, image-pack integrity, and data-cache consistency without requiring macro artifacts or a WASM build. The cache identifier retains the existing app-shell identity and adds a content-based data suffix. Unfinished local application edits do not enter publication. The original index retains unrelated staged changes, including edits elsewhere in the same JavaScript files.

State records completed pipeline commands and the commit/push/deployment phases. Before generation, the public files are backed up locally. A failed generation or validation restores these files without resetting the index. For recipe-list-triggered updates, a later attempt starts generation from the beginning after a generation or validation failure. Committed and pushed updates resume their remaining publication steps. The commit journal permits recovery when interruption occurs between updating `main` and recording the completed commit. Resolving a deferred item-order signature does not prevent recovery of the saved commit for the same source version and counts.

If generated public data is unchanged, the run finishes successfully without an empty commit or deployment. If files changed, the automation commits them to `main`, pushes the saved commit SHA explicitly to `refs/heads/main`, waits for the workflow run whose commit SHA exactly matches the pushed commit, and reports the deployment result. A retry never pushes later, unrelated local commits through `HEAD`.

## Log archives

The monitor invokes the shared log-archive routine at startup. Logs from a completed month are written to a verified monthly ZIP before their source files and archived monitor lines are removed. Monthly ZIP files from a completed year are embedded in a verified yearly ZIP and then removed. Repeated runs are idempotent. Month and year boundaries are evaluated in JST.

## Persistent records

The monitor maintains a comparison manifest, immutable compressed source artifacts, an applied-data record, publication checkpoints, recovery backups, and execution logs. These records support integrity checks and interrupted-run recovery.

All persisted and displayed timestamps use JST in `YYYY-MM-DDTHH:mm:ss.sss+09:00` format.

## Ubuntu VPS migration and offline verification

The Windows task must remain disabled during migration. The Ubuntu entrypoint is
`tools/run-lodestone-monitor.mjs`. With no arguments, or with `--offline`, it only
validates local data. It never imports the live monitor, reads credentials, invokes
notification delivery, archives logs, regenerates a baseline, or contacts a server.

```bash
node tools/run-lodestone-monitor.mjs --offline
```

Run with Node 24 and the existing CPU/memory limits. The check reads `Item.json`,
the applied receipt, the publication journal, and the comparison manifest. It copies
the audit SQLite file and any WAL/SHM files into an OS temporary directory and opens
only that copy. It checks database integrity, the completed applied audit, every
baseline recipe-list artifact and parsed row, and equality with the saved manifest.
Temporary copies are removed afterward. It does not open or migrate the source DB.
It requires the existing applied baseline; it does not silently seed missing data.
Do not run this check concurrently with a manual cache writer or during a data copy.

A result with `status: published` and `recovery: false` does not resolve, restore,
or delete an obsolete snapshot. For `committed` or `pushed`, it verifies the saved
commit objects locally without pushing or consulting GitHub. For `generating`, it
also verifies the snapshot, backup files, and any commit/index recovery journal.
During a pending publication, the previous comparison baseline is validated against
its own completed audit, separately from the newer applied audit. It is not promoted
by the check. If generation has changed `Item.json` before updating the applied
receipt, a hash-matching snapshot backup may supply the applied-data verification;
the offline check never copies that backup over the working file.

Missing/corrupt data fails verification and must be recovered from a verified backup;
do not delete state, reset a branch, or change a status to force the check to pass.

### Portable journals and legacy Windows paths

New publication journals store `snapshotRoot` relative to the repository, using `/`,
and mark `pathFormat: repository-relative-v1`. New commit journals store `.git/index`
in the same format. Current-root absolute paths from previous versions are readable.
Linked worktrees with an index outside this repository are not supported by this
migration path: verification fails rather than redirecting index writes.

An old Windows absolute path is accepted only when its old repository root is
explicitly configured. No drive translation, suffix search, or basename guessing is
performed. Only `pipeline/state/auto-publish-files-*` and `.git/index` are supported.
Traversal, missing files, ambiguous old roots, and symlinks escaping the current
repository are rejected. The resolved recovery index must match Git's actual index.
The legacy configuration is for reading old records; the old JSON files are not
rewritten just to translate a path.

```bash
node tools/run-lodestone-monitor.mjs --offline --legacy-root 'C:\exact\old\ffxiv-recipe'
```

Specify the actual old root, not the example. The normal Ubuntu runner also accepts
`migration.legacyRepositoryRoots` in its private configuration. Windows entrypoints
read the same setting from their existing local monitor configuration. Retain the
original cache, reports, state, backup indexes, and Git objects needed by pending
journals. Never copy a live SQLite file without its WAL or a consistent backup.

### Private configuration and GitHub authentication

No private configuration or credential is installed by the repository templates.
Prepare these files for `ffxivdev` only after offline verification:

- `~/.config/ffxiv-recipe/lodestone-monitor.json`: copy the shape of
  `pipeline/config/lodestone-monitor.ubuntu.example.json`, then supply the webhook
  privately and any verified legacy roots.
- `~/.config/ffxiv-recipe/github-token`: a GitHub token with the minimum repository
  permissions needed to push the allowed data and read Actions workflow results.

The directory should have mode 700; both files must be owned by `ffxivdev` and have
mode 600. The runner checks file ownership/permissions, loads the token into
`GH_TOKEN` only for the monitored operation and its children, and restores the
previous process environment on completion or failure. It does not print credentials.
Never put the token in a unit, an argument, a tracked file, shell history, or a log.

Install GitHub CLI for this user or into a shared executable location and verify
its actual path. Configure Git's credential helper **in this repository only** to
use `gh auth git-credential` for HTTPS. Do not reuse Windows Credential Manager or
change global Git configuration. Check Git author identity and the `origin` URL
without printing embedded credentials. The service's PATH must include both Node
and `gh`; it does not source NVM or interactive shell initialization. Inherited Git
prompt suppression remains enabled. Authentication testing involving GitHub requires
separate authorization; offline verification does not validate token permissions.

### systemd user templates (not installed or enabled automatically)

Templates live in `deployment/systemd/user/`. They are user units, run as the owner
of the user manager, and remain under `user-1003.slice` for `ffxivdev`. They do not
modify another user's services or limits. Confirm that this parent slice retains
CPUQuota 200% and MemoryMax 2GiB. The service additionally sets CPUQuota 200%,
MemoryHigh 1536MiB, MemoryMax 2GiB and Nice 10. Its parent Node heap is 256MiB;
generation children retain the configured 1024MiB heap. Native allocations and all
children remain subject to the cgroup limit. Avoid simultaneous heavy development
work under the same user's 2GiB budget.

Review the absolute Node version and repository path in the template before
installation. The service contains `--run`: **starting it permits real Lodestone
reads, Discord messages, Git commits/pushes and deployment polling**. Static
verification does not execute this command:

```bash
systemd-analyze --user verify deployment/systemd/user/ffxiv-lodestone-monitor.service deployment/systemd/user/ffxiv-lodestone-monitor.timer
```

The timer proposes five minutes after user-manager startup and fifteen minutes
between completed runs. Match the former Windows schedule before deployment.
It does not queue a backlog of missed calendar runs. The service is oneshot, does
not restart on failure, has no overall update timeout, and waits up to 120 seconds
when explicitly stopped before systemd terminates its own cgroup. Do not stop it
in the middle of a normal publication; a forced stop can leave a recovery journal
and a reservation lock that require inspection. No other project's PID is killed.

Only after an approved online trial: install the two reviewed user unit files,
reload the user manager, and explicitly enable/start the timer. Verify linger for
`ffxivdev` if scheduling must survive logout. Do not enable the Windows task as well.
Repository updates never perform these installation/activation operations.

### Exclusion and crash recovery

All Windows-compatible and Ubuntu monitor entrypoints acquire
`pipeline/state/lodestone-monitor.lock` before configuration-dependent work,
preflight, log archiving, source comparison, publication, or baseline/state updates.
A second invocation fails before doing those operations. The separate existing
`auto-publish.lock` continues to protect publication. Manual data writers outside
these entrypoints must not run concurrently with the monitor. Local locks cannot
coordinate two VPSs or Windows hosts; keep the Windows task disabled.

The monitor lock is an exclusive reservation with an owner token. It is released
on normal completion or exceptions only if the token still matches. Empty,
malformed, stale, and PID-reused reservations are never automatically deleted.
After a crash, leave the timer inactive, inspect the lock's host/PID and all child
processes, and establish that no writer remains. Do not signal a process based
only on a saved PID. Preserve the lock and journal as evidence; removing a verified
stale reservation is a deliberate operator recovery action, never an offline-check
side effect. The offline command reports both monitor and publication lock presence.

Run offline verification again before resuming. A `generating` journal may recover
a completed commit/index transition or restore verified backups; a `committed`
journal resumes the exact saved SHA; `pushed` resumes deployment confirmation.
`published` never initiates recovery from its obsolete backup. Unknown paths and
missing commit objects must be resolved before resumption, without resetting Git
history or initializing a new baseline. Retain the baseline until publication and
deployment confirmation complete successfully.

Before live deployment, run the migration and existing monitor/publication unit
tests sequentially in the resource-limited scope. They use temporary fixtures,
local Git repositories/mocks, and fake HTTP responses. Test Windows separately;
Windows-style path fixtures on Ubuntu do not replace Windows execution. Browser
E2E, WASM/Tauri builds and a full Lodestone crawl are not required for offline checks.
