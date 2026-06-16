# Development

## Environment

- Node.js 22 or later recommended
- Windows 11 for PowerShell data pipeline scripts
- PowerShell scripts must remain UTF-8 with BOM and CRLF line endings

Install Node.js dependencies:

```powershell
npm install
```

## Checks

Run the standard JavaScript and site validation checks:

```powershell
npm run check
```

This runs:

- JavaScript syntax checks for `site/app.js`, `site/sw.js`, and `tools/validate-site.mjs`
- Site asset and PowerShell encoding validation through `tools/validate-site.mjs`

Run Markdown lint:

```powershell
npm run lint:md
```

## UI Regression Tests

Playwright tests cover key browser behavior:

- LICENSE / NOTICE dialog opens and closes
- `+5` and `-5` count buttons update the selected recipe count
- `使用先` buttons use the expected accent style
- Crossing the 600px responsive breakpoint resets the screen to the startup view

Run the tests:

```powershell
npm run test:e2e
```

Playwright starts a local static server with:

```powershell
node .\tools\serve-site.mjs --port 4173
```

## Formatting

Check Prettier formatting:

```powershell
npm run format:check
```

Apply Prettier formatting:

```powershell
npm run format
```

Formatting can touch many files, so prefer a dedicated formatting commit when applying it.

## Data Pipeline

Data generation is documented separately in [data-pipeline.md](data-pipeline.md).
