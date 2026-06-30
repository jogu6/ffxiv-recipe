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

Run the standard checks:

```powershell
npm run check
```

This runs:

- JavaScript syntax checks through `npm run check:js`
- Site asset and data validation through `npm run check:site`
- Calculation unit tests through `npm run check:calculation`
- Pipeline tool and GUI contract tests through `npm run check:pipeline`

Run a single check when you only need that target:

```powershell
npm run check:js
npm run check:site
npm run check:calculation
npm run check:pipeline
```

Run Markdown lint:

```powershell
npm run lint:md
```

## UI Regression Tests

Playwright tests cover key browser behavior, including:

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
