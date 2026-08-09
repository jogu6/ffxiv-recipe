# Lodestone Data Pipeline

The local pipeline builds the static application's recipe data from the Japanese Lodestone.

## Public data model

`site/data/Item.json` contains only data used by the application:

- `Version`: the Lodestone Version
- `Items`: records keyed by the unique Japanese item name
- `SortOrder`: a presentation value derived from the descending Lodestone item list
- Lodestone recipe, category, icon, shop, gathering, equipment, and EX fields used at runtime

Recipe ingredients refer to `Name`; neither item IDs nor ingredient item IDs are published. `site/data/legacy-item-ids.json` contains only old ID-to-name mappings required to migrate saved browser data and old share codes.

Every `IconFile` uses `{item-name-sha256-20}-{webp-content-sha256-12}.webp`, sharded under the first three name-hash characters. This makes icon paths independent of item IDs and list order while changing the URL whenever the generated WebP changes. Generation stops on any truncated-hash collision.

Items absent from the Lodestone item list are excluded. The regular target set consists of items with Lodestone recipes and all ingredients recursively reached by those recipes. Existing hand-maintained exchange data in `pipeline/input/token-items.csv` is preserved. Supplemental exchange currencies may remain without `SortOrder`.

## Sequential access

All external reads use one sequential request queue. Parallel requests are prohibited. The default interval is 100 milliseconds and can be changed in the pipeline GUI.

## Item-order cache

The first item in the descending Lodestone item list receives the total item count as `SortOrder`; each following item decrements by one. The saved order can be reused only when both the Lodestone Version and total item count are unchanged. Otherwise, every item-list page is read again and a new order signature is stored.

Recipe-list metadata is checked separately. Candidate generation uses the saved recipe list and verified Lodestone recipe-detail cache.

The snapshot step caches every recipe-detail page. During candidate generation, an item that is not present in the current public document is recognized as new and its Lodestone item-detail page is read to populate EX, equipment, and unconditional shop data. No alternate data source is used.

## GUI and CLI workflow

`pipeline/tool/pipeline-ui-definition.mjs` is the single source of truth for GUI modules, nested setting groups, accordions, and action groups. The renderer builds those controls dynamically while progress, cancellation, and logs remain fixed application-level functions. The GUI exposes these four actions and the same sequence as a single combined run:

```powershell
node pipeline/tool/pipeline-tool.mjs lodestone-snapshot --delay 100
node pipeline/tool/pipeline-tool.mjs build-lodestone-candidate --delay 100
node pipeline/tool/pipeline-tool.mjs lodestone-candidate-icons --delay 100 --quality 80 --size 80
node pipeline/tool/pipeline-tool.mjs publish-lodestone-candidate
```

The image settings group also exposes an in-GUI comparison preview. It re-encodes deterministic representative Lodestone PNG samples at the selected size and quality without modifying public data. The GUI log keeps every received line, batches only high-frequency rendering, and follows new output only while the viewer is already at the bottom.

Candidate files and downloaded source caches remain local. Hand-maintained exchange-currency images are protected under the local-only `pipeline/input/manual-item-icons/` directory. With that input present, the complete public icon directory can be regenerated from an empty output directory by the image step; listed items are read from the saved source cache or fetched sequentially when absent.

Publication is rejected when names are duplicated, a referenced image is missing, an image filename does not match its item name and WebP content, or the compatibility mapping is invalid. The existing public `Item.json` is protected locally before replacement. Only after the new document and every referenced image pass validation are unreferenced legacy WebP files removed.

When a hand-maintained item name is not found, generation stops with similar Lodestone names for manual confirmation. The unambiguous corrections `一時`→`一次`, `二時`→`二次`, `三時`→`三次`, and `四時`→`四次` may be applied automatically when the corresponding candidate exists.

## Verification

Run the shared checks after generation:

```powershell
npm run check
npm run test:e2e
```

Generated local inputs, caches, reports, source images, and intermediate files must not be committed unless they are required under `site/`.
