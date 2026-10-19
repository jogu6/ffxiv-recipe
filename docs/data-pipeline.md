# Lodestone Data Pipeline

The pipeline builds the static application's recipe data from the Japanese Lodestone. The Node.js generation tools are also exposed through a Tauri GUI.

## Public data model

`Item.json` is the main public document:

- `Version` identifies the Lodestone version.
- `DataGeneration` identifies the audited item order and canonical recipe contents.
- `Items` is an array of records identified by unique Japanese `Name` values.
- Item records contain the recipe, category, icon, shop, gathering, equipment, and EX fields used by the application.
- `GatheringLevels` records the gathering method and level from the item's gathering log. `ExchangeInfo` records payment items, quantities per item, and vendors from the official exchange table. Each entry is a separate alternative; multiple payment items within one entry are required together.
- Recipes include ingredients, result amounts, crafting jobs, and available crafting parameters for macro generation. `CraftingData.RequiredQuality` records the official minimum quality needed for completion, independently of HQ availability. An absent minimum-quality condition becomes an explicit zero; a present but unreadable condition fails validation. Scheduled quality-only updates use the same official HTML cache as generation and retries. They retain the verified catalog lineage and refresh the quality field without crawling unrelated catalog pages; later generation prefers newer official quality observations over an older audit. Items with multiple recipes retain their selectable alternatives.

Ingredients refer to `Name`. Numeric item IDs are not published in the main document. The separate `legacy-item-ids.json` compatibility mapping supports migration of older browser data and share codes.

`SortOrder` follows the descending Lodestone item list: the first item receives the total count, and later items decrement by one. The regular target set includes crafted items and recursively required ingredients. Configured exchange items and currencies supplement that set; a supplemental currency may have no `SortOrder`.

Candidate generation preserves equipment, icons, and additional document fields while rebuilding recipes, ordering, gathering, and shop information from Lodestone. Name aliases carry fields across renames. New items obtain required fields from audited detail data or sequential source reads. Preservation checks distinguish explicitly retired items from unexpected missing records.

Gathering-detail pages provide regions, maps, local place names, levels, folklore categories, and technical requirements where published. `GatheringLevels[].chronicle` contains the required mineral or botanical folklore book, derived from that page's breadcrumb category. The application displays the book instead of the ordinary level badge, matching crafting master-book labels. Officially confirmed fields take precedence. When a field is absent or hidden as `????`, `gathering-supplements.json` supplies manual maps, ET schedules, gathering-point types, and technical requirements; `gathering-area-supplements.json` supplies regional grouping only when the official region is also hidden. A missing official map must never discard the matching item's manual schedule. Multiple maps remain distinct and duplicate supplement rows are collapsed. If a gathering-detail request fails and manual data exists for that method, the same fallback retains it alongside previously confirmed levels; without a usable fallback the update fails. The same reader is used for scheduled comparison and candidate generation.

Purchase and exchange information is indexed from the official shop list. Each shop is fetched once per update and its inventory is inverted into item records. Inclusion shops such as scrip vendors also enumerate every category from the official selector and fetch its exchange HTML. Categories shared by multiple vendors are fetched once per crawl, while each vendor keeps its own location. Category HTML is cached with the parent source version and the same expiry policy as complete pages. Gil prices, payment items, result quantities, and military ranks come from those shop pages. Store buttons and the store dialog are restricted to unconditional gil sales in `ShopInfo`; exchange entries in `ExchangeInfo` do not qualify an item for store information and are not rendered there. `gil-shop-supplements.json` preserves unconditional manual-only vendors such as housing employees. Official prices and existing vendor coordinates take precedence, and matching vendors are not duplicated. Manual vendors with a required rank, or vendors confirmed conditional by the official shop pages, remain excluded. The same merge runs during scheduled comparison and candidate generation. This avoids fetching an item-detail page for every sold item. Partial or version-inconsistent shop crawls fail before publication.

The former tribal-shop and exchange inputs use `.migrated.json` or `.migrated.csv` names after migration and are excluded from normal generation. The remaining gathering supplement removes manually recorded folklore books and the folklore-derived gathering type. Housing vendors not listed in the official database remain active in `gil-shop-supplements.json`.

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

Currency images are preserved as generation inputs. Existing generated exchange routes identify preferred payment currencies without depending on the former hand-maintained CSV. If an item name cannot be resolved, generation stops with similar source names for review. The unambiguous corrections `一時`→`一次`, `二時`→`二次`, `三時`→`三次`, and `四時`→`四次` may be applied when the corresponding candidate exists.

Acquisition HTML uses the shared compressed SQLite cache. Successfully parsed pages are reused across scheduled checks, candidate generation, and retries for up to one hour; expired pages and pages from another source version are fetched again. Failed reads never replace a valid cached page. Exchange quantities come from the official tables; routes absent from those tables are removed. Newly encountered single-currency routes using known payment currencies can be added automatically. Alternative routes are never added together. `ExchangeInfo[].resultAmount`, when present, records a batch's received quantity; ingredients remain the payment for that batch. Military-seal tables retain each vendor's required rank, including the distinct rank names of the three Grand Companies.

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
