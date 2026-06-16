# Data pipeline

## Environment

- Windows 11
- PowerShell 7 recommended
- All `.ps1` files must be UTF-8 with BOM and CRLF line endings

## Inputs

`pipeline/input/` contains the source CSV files and manually maintained token exchange data.

```text
Item.csv
Recipe.csv
ItemUICategory.csv
ItemSearchCategory.csv
token-items.csv
```

## Build steps

```text
01-convert-items.ps1
  -> pipeline/intermediate/items-base.json
02-add-recipes.ps1
  -> pipeline/intermediate/items-with-recipes.json
03-add-token-recipes.ps1
  -> pipeline/intermediate/items-with-tokens.json
04-add-ui-categories.ps1
  -> pipeline/intermediate/items-with-ui-categories.json
05-filter-items.ps1
  -> pipeline/intermediate/items-filtered.json
06-build-public-data.ps1
  -> site/data/Item.json
```

Run all data build steps:

```powershell
pwsh -File .\pipeline\scripts\08-build-all.ps1
```

Download missing item icons:

```powershell
pwsh -File .\pipeline\scripts\07-download-icons.ps1
```

Item icons are grouped by the first three digits of their six-digit file name:

```text
site/assets/item-icons/020/020001.png
```

## Reference and logs

- `pipeline/reference/csv-headers/`: numbered CSV column references
- `pipeline/logs/`: download errors and pipeline logs retained for investigation
- `pipeline/intermediate/items-truncated.json`: retained historical/manual intermediate output; it is not part of the automated build chain

Missing icons listed in `pipeline/logs/icon-download-errors.txt` are treated as known upstream download failures. Validation fails only when an unlogged icon is missing.
