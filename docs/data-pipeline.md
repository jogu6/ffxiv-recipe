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
housing-shops.json
equipment-role-overrides.json
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
sections: CSV and data generation, build checks, and icon quality. The first section is open on
startup; opening another section closes the current one. Long operations ask for confirmation,
stream progress without repeatedly rebuilding the full log, estimate uncached work separately,
and support safe cancellation from both the cancel button and window close. The "全実行" button
runs CSV validation, candidate generation, icon generation, Lodestone information, and public
publishing in order. Publishing is an explicit final step; earlier operations do not replace the
public `Item.json`.

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

Build a public candidate, add Lodestone info, then verify and publish it atomically:

```bash
node pipeline/tool/pipeline-tool.mjs build
node pipeline/tool/pipeline-tool.mjs publish-lodestone-info --delay 100
node pipeline/tool/pipeline-tool.mjs publish
```

Run the full local pipeline without the GUI:

```bash
node pipeline/tool/pipeline-tool.mjs run
```

This runs CSV validation, candidate generation, icon generation, Lodestone info publishing, and
publish in order. The default Lodestone access delay is 100 ms. The default icon access delay is
500 ms.

Run only the Lodestone-derived shop, crafting, equipment, stats, and performance step:

```bash
node pipeline/tool/pipeline-tool.mjs publish-lodestone-info --delay 100
```

The Lodestone command keeps strict exact-name matching, follows all result pages, caches fetched
HTML under `pipeline/cache/lodestone-shops/`, and reuses cached HTML without an access delay.
`--force` bypasses completed-item skipping but does not bypass the HTML cache. Player-state
dependent shops are excluded. `housing-shops.json` is merged after Lodestone processing when the
file exists. Equipment roles are inferred where unambiguous and then supplemented from
`equipment-role-overrides.json`.

```json
{
  "ShopInfo": {
    "price": 9,
    "shops": [{ "shopName": "素材屋 エンゲランド", "area": "リムサ・ロミンサ：下甲板層", "x": 8.6, "y": 11.8 }]
  },
  "CraftInfo": [{ "job": "鍛冶師", "level": 1 }],
  "EquipmentInfo": {
    "itemLevel": 9,
    "jobs": ["全クラス"],
    "equipLevel": 9,
    "stats": { "STR": 1, "DEX": 1, "VIT": 1, "INT": 1, "MND": 1 },
    "performance": {
      "physicalDamage": 0,
      "magicalDamage": 0,
      "physicalDefense": 8,
      "magicalDefense": 8
    },
    "recommendedRole": "fighter"
  }
}
```

After Lodestone processing, use the GUI's "推奨ロール確認" view for unresolved broad equipment.
Groups are keyed by equipment level, item level, slot, compatible stat signature, and related item
names. The view shows icons, stats, current counts, and direct Lodestone links. Assigned groups are
collapsed on the next open; unresolved groups remain expanded. Saving writes the local-only
override JSON, and the next Lodestone information run applies it to the candidate. Not every group
must be assigned before saving.

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
in-app floating view using app-managed preview data. The GUI does not start a local preview web
server.

Launch the pipeline GUI:

```bash
npm run pipeline:gui
```

## Reference and logs

- `pipeline/reference/csv-headers/`: numbered CSV column references
- `pipeline/state/`: update check, resumable run state, icon state, and resolved Lodestone item URLs
- `pipeline/reports/`: generated quality reports
- `pipeline/logs/`: download errors and pipeline logs retained for investigation

Files under `pipeline/input/`, `pipeline/intermediate/`, `pipeline/reference/csv-headers/`, and
`pipeline/logs/` are local-only and are not tracked in Git. The web app reads only
`site/data/Item.json` at runtime; auxiliary JSON inputs are merged during development rather than
fetched by the deployed app.

Missing item icon files under `site/assets/item-icons/` are allowed. The app hides broken icon images and continues to work.
