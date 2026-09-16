# Lodestone Data Pipeline

The pipeline builds the static application's recipe data from the Japanese Lodestone. The Node.js generation tools are also exposed through a Tauri GUI.

## Public data model

`Item.json` is the main public document:

- `Version` identifies the Lodestone version.
- `DataGeneration` identifies the audited item order and canonical recipe contents.
- `Items` is an array of records identified by unique Japanese `Name` values.
- Item records contain the recipe, category, icon, shop, gathering, equipment, and EX fields used by the application.
- Recipes include ingredients, result amounts, crafting jobs, and available crafting parameters for macro generation. Items with multiple recipes retain their selectable alternatives.

Ingredients refer to `Name`. Numeric item IDs are not published in the main document. The separate `legacy-item-ids.json` compatibility mapping supports migration of older browser data and share codes.

`SortOrder` follows the descending Lodestone item list: the first item receives the total count, and later items decrement by one. The regular target set includes crafted items and recursively required ingredients. Configured exchange items and currencies supplement that set; a supplemental currency may have no `SortOrder`.

Candidate generation preserves existing equipment, gathering, shop, icon, and additional document fields while rebuilding recipe and ordering data. Name aliases carry fields across renames. New items obtain required fields from audited detail data or sequential source reads. Preservation checks distinguish explicitly retired items from unexpected missing records.

## Complete audit

A complete audit plans every item-list, recipe-list, and recipe-detail page, fetches them sequentially, and stores immutable compressed artifacts. Interrupted manual audits resume completed work. Promotion requires the full plan, final consistency checks, comparisons, and integrity hashes. A source-version drift invalidates the audit rather than mixing source generations.

The item-order cache is reusable only when the source version and item count match. Recipe-list metadata is checked separately. Identical audited order and recipe contents produce the same `DataGeneration`, avoiding unnecessary data-only publication.

All external reads share a sequential request queue. The default interval is 100 milliseconds. The GUI accepts intervals from 100 to 60,000 milliseconds. Source pages are compressed or released as work progresses, and generated-data child processes use bounded heaps and below-normal CPU priority.

## GUI workflow

Start the GUI from the main package:

```powershell
npm run pipeline:gui
```

The UI definition supplies settings, labels, arguments, action order, confirmations, and resume behavior. The combined generation action runs:

1. Complete Lodestone audit.
2. Candidate item-document generation.
3. Image-cache preparation from the verified public pack.
4. Missing-image acquisition and WebP generation.
5. Validated item-document publication, including the image pack and cache identifiers.
6. Synchronization of images needed by published share codes to the information site.
7. Public image-pack validation.

Individual actions also provide image quality preview, explicit pack regeneration, and application-cache recalculation. The preview compares representative source images without changing public data. Default image settings are quality 80 and size 80 pixels.

The GUI supports cancellation, checkpoint-based resumption where available, persisted settings, and logs. Log rendering is batched without dropping received lines, and automatic scrolling follows output only when the viewer is already at the bottom.

## Images and publication

Each item `IconFile` combines a 20-character item-name SHA-256 prefix and a 12-character WebP-content SHA-256 prefix, followed by the WebP extension. A three-character name-hash shard groups entries. This keeps the identity independent of numeric IDs and item order; content changes produce a new identifier. Truncated-hash collisions reject generation.

`item-icons.pack.gz` packages the required item and job images. The browser verifies the pack before using it, then resolves entries to displayable image URLs. Publication therefore distributes the pack instead of requiring individual item-image requests. Image-cache preparation can reconstruct individual generation inputs from the existing verified pack.

Publication rejects duplicate names, missing images, mismatched content hashes or image names, invalid compatibility mappings, and failed preservation checks. The previous public document is protected before replacement. Only validated candidates replace it; unused images are removed after remaining references have been verified.

Hand-maintained exchange data and currency images are preserved as generation inputs. If an item name cannot be resolved, generation stops with similar source names for review. The unambiguous corrections `一時`→`一次`, `二時`→`二次`, `三時`→`三次`, and `四時`→`四次` may be applied when the corresponding candidate exists.

Successful publication records the applied audit, source metadata, data generation, and document hash. Candidate generation alone does not create an applied record.

## Verification

Use the relevant existing checks:

```powershell
npm run check:site
npm run check:pipeline
npm run check:calculation
npm run check:macro-launcher
```

Browser verification selects affected behavior through `npm run test:e2e -- --grep "<test name>"`. Packaging and checks are described in the [development guide](development.md). Scheduled comparison and GitHub Pages publication are described in the [monitor guide](lodestone-update-monitor.md).
