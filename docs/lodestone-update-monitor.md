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
