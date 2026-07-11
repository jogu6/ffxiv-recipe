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

- recipe trees, material lists, intermediate ordering, and usage details
- favorites, combined material lists, ring counts, sharing, and restored view state
- shop and gathering dialogs, purchased intermediates, and mobile status display
- equipment search filters, role matching, per-slot fallback, and result saving
- desktop/mobile layout, scrolling, loading interaction blocking, and the 600px breakpoint
- pipeline GUI contracts and browser-visible operation flows

Run the tests:

```powershell
npm run test:e2e
```

Playwright starts the same local static server used for LAN device checks:

```powershell
py -m http.server 4173 --bind 0.0.0.0 --directory site
```

The site keeps favorites, search history, favorite item counts, and restorable view state in
`localStorage`. A version-update reload deliberately discards restorable view state once. Tests
that cross the 600px responsive breakpoint must account for the intentional reset to the startup
view.

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
