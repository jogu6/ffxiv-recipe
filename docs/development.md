# Development

## Environment

The project requires Node.js 24 or later. Python provides the browser preview and E2E server. The data-generation GUI targets Windows 11 and requires the Rust/Tauri build environment.

The macro engine uses Rust, the WebAssembly target, wasm-pack, and rust-src. The Pages workflow pins its Rust toolchain to `nightly-2026-05-10` and builds both single-threaded and parallel engines.

Install the main package dependencies:

```powershell
npm install
```

Use `npm run dev` for a static preview on port 4173. Build and stage the macro application before previewing its integrated panel.

## Checks

The main package exposes these independently runnable checks:

| Command                            | Coverage                                                              |
| ---------------------------------- | --------------------------------------------------------------------- |
| `npm run check:js`                 | JavaScript syntax                                                     |
| `npm run check:site`               | Published assets, data, and related consistency checks                |
| `npm run check:app`                | Application state, search, favorites, sharing, layout, and caches     |
| `npm run check:calculation`        | Material calculations                                                 |
| `npm run check:pipeline`           | Generation, monitoring, publication, GUI contracts, and tool wrappers |
| `npm run check:crafting-mechanics` | Crafting-mechanics generator syntax                                   |
| `npm run check:macro-launcher`     | Host integration and consumable cache                                 |
| `npm run pipeline:gui:check`       | Rust/Tauri incremental check                                          |

`npm run check` runs the seven `check:*` entries above together. It does not build WASM or run the macro package's Rust tests.

From the macro package, `npm run check` runs its JavaScript checks, JavaScript tests, and engine tests. `npm run check:wasm` also rebuilds WASM. See the [macro guide](../macro-app/README.md).

## Browser regression tests

Browser coverage includes recipe trees, material calculations, favorites, equipment searches, text and image sharing, state restoration, startup caching, PWA updates, responsive layouts, inquiries, macro generation and storage, and the pipeline GUI.

Select a test by name through the main package:

```powershell
npm run test:e2e -- --grep "<test name>"
npm run test:e2e:app -- --grep "<test name>"
npm run test:pipeline:gui
```

The runner requires a target or an explicit `--full` selection. It creates and cleans up its own server; an occupied test port causes startup to fail. Public-site tests run sequentially within each file and concurrently across files, with two to four workers during development and two in CI. GUI tests use isolated Tauri mocks and also permit concurrency within their file. The runner rejects overrides to worker count, configuration, and full parallelism.

Browser projects include Chromium and targeted mobile, WebKit, and Firefox checks. Browser emulation does not measure a physical device's available memory or reproduce its operating system limits.

## Application state and caching

Favorites, search history, production counts, display settings, and restorable view state use `localStorage`. An update reload skips view restoration once, and crossing the 600px layout boundary resets the active view.

IndexedDB holds generation-specific application models and macro consumable data. Image packs are validated against their expected hash and cached through Cache Storage, with an IndexedDB fallback. Shared images and macro generation have their own storage lifecycles. See the [cache notes](service-worker-notes.txt).

## Builds and publication

The macro package provides:

```powershell
npm run build:wasm
npm run build:wasm:dev
npm run stage:site
```

The first command builds production engines; the second builds development engines. Staging copies browser runtime files, engines, and the required bundled notice into the generated public application.

The main package provides:

```powershell
npm run pipeline:gui:build:exe
npm run pipeline:gui:build:timings
npm run pipeline:gui:build
```

The Tauri wrapper detects the Rust linker and supports compiler caching. Checks retain incremental compilation. Executable and installer builds cache dependencies while retaining incremental compilation for the application. The timing build emits Cargo timing reports.

Pages deployment compares engine sources with the latest successful Pages deployment. When they are unchanged, it downloads the deployed engines and verifies both WASM hashes before staging; data and browser UI changes do not rebuild the engines. Download, source-comparison, or integrity failures stop the workflow rather than triggering a replacement build. Actual engine-source changes enable the pinned Rust/WASM build steps. Targeted startup, parallel-search, and allocation-recovery browser checks run on Windows. The deployment job stages the macro application, recalculates the application cache identifier, validates the site, and uploads the static artifact. Pushes to `main` affecting the public app, macro package, engine-preparation tool, or deployment workflow trigger this process; manual workflow dispatch is also available.

After changing deployed app-shell assets, `npm run cache:app` recalculates content-based cache and report identifiers while retaining the existing release number.

## Documentation and formatting

`npm run lint:md` runs Markdown lint, with a separate configuration for the release document. `npm run format:check` checks supported source formats. The formatting wrapper supports explicitly selected files; select the affected documents instead of applying a repository-wide rewrite.

## Data generation

See the [data pipeline](data-pipeline.md) and [update monitor](lodestone-update-monitor.md) for source audits, image generation, automatic publication, and recovery.
