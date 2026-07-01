# Data pipeline

## Environment

- Windows 11
- Node.js
- `sharp` for item icon resizing, WebP conversion, and quality preview generation
- Tauri GUI: `FF14レシピ素材ツリー アイテム情報作成` (`makeRecipe.exe`, tool version v1.0)

## Inputs

`pipeline/input/` is the local-only input directory. Its CSV and JSON files are ignored by Git, so
do not treat the repository checkout as containing a complete input set. Remote CSV files are
downloaded from `xivapi/ffxiv-datamining` `csv/ja`; local hand-maintained input files are never
downloaded or overwritten.

```text
Item.csv
Recipe.csv
ItemUICategory.csv
ItemSearchCategory.csv
token-items.csv
gathering_area.json
gathering_timer.json
```

## GUI workflow

Launch the GUI during development:

```bash
npm run pipeline:gui
```

Build the standalone exe:

```bash
npm run pipeline:gui:build
```

The release binary is `src-tauri/target/release/makeRecipe.exe`. The GUI has three collapsible
sections: CSV, Build, and Icon Quality. CSV is open on startup; opening one of the three sections
closes the others. Long operations ask for confirmation and stream progress/log output while they
run.

## Build steps

```text
pipeline/tool/pipeline-tool.mjs build
  -> pipeline/intermediate/01-items-base.json
  -> pipeline/intermediate/02-items-with-recipes.json
  -> pipeline/intermediate/03-items-with-token-recipes.json
  -> pipeline/intermediate/04-items-with-ui-categories.json
  -> pipeline/intermediate/05-items-filtered.json
  -> pipeline/intermediate/06-public-items.json
```

Build a public candidate, then verify and publish it atomically:

```bash
node pipeline/tool/pipeline-tool.mjs build
node pipeline/tool/pipeline-tool.mjs publish
```

Check or download remote CSV files:

```bash
node pipeline/tool/pipeline-tool.mjs check-updates
node pipeline/tool/pipeline-tool.mjs download-csv
```

Ensure item WebP icons:

```text
node pipeline/tool/pipeline-tool.mjs icons
```

Item icons are grouped by the first three digits of their six-digit file name:

```text
site/assets/item-icons/020/020001.webp
```

The icon command uses Lodestone NQ item images as the primary source and XIVAPI image URLs only as
a fallback when Lodestone lookup or download fails. Downloaded source PNG files are cached under
`pipeline/cache/lodestone-icons-png/` by item ID and are never tracked in Git. Public WebP files are
always regenerated as 80x80 q80 images under `site/assets/item-icons/` while keeping the existing
`IconFile` names used by the app.

HTTP 404 and other download failures are logged and counted in progress; failed URLs and fallback
details are retained under `pipeline/logs/` for investigation.

The selected WebP quality, output size, source, and current `Item.json` hash are stored under
`pipeline/state/icon-quality.json`.

Generate a phone-friendly quality preview:

```bash
node pipeline/tool/pipeline-tool.mjs tmp-quality-preview --qualities 50,60,70,80
```

The Tauri GUI reuses an existing comparison page when the current `Item.json`, fixed q50/q60/q70/q80
set, and sample count match the saved manifest. When reusable preview data exists, the button is
shown as "比較ページ表示"; otherwise it is shown as "比較ページ生成". The preview opens as an
in-app floating view using app-managed preview data, not a raw `file://` page.

Launch the pipeline GUI:

```bash
npm run pipeline:gui
```

## Reference and logs

- `pipeline/reference/csv-headers/`: numbered CSV column references
- `pipeline/state/`: update check and resumable run state
- `pipeline/reports/`: generated quality reports
- `pipeline/logs/`: download errors and pipeline logs retained for investigation
- `pipeline/intermediate/items-truncated.json`: retained historical/manual intermediate output; it is not part of the automated build chain

Files under `pipeline/input/`, `pipeline/intermediate/`, `pipeline/reference/csv-headers/`, and `pipeline/logs/` are local-only and are not tracked in Git.

Missing item icon files under `site/assets/item-icons/` are allowed. The app hides broken icon images and continues to work.
