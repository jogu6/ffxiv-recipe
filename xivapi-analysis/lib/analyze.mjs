import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseCsvFile } from "./csv.mjs";
import {
  ensureDirectory,
  readJson,
  writeJsonAtomic,
  writeTextAtomic,
} from "./files.mjs";
import {
  cacheRoot,
  capabilityConfigPath,
  csvRoot,
  itemJsonPath,
  manualReviewConfigPath,
  manifestPath,
  outputRoot,
  reportsRoot,
  schemaRoot,
} from "./paths.mjs";
import { loadSchemas } from "./schema.mjs";
import { buildTargetItems } from "./targets.mjs";

const ANALYSIS_CACHE_VERSION = 3;

const CATEGORY_RULES = [
  ["納品・依頼", /Satisfaction|Supply|CraftWorks|Inspection|Delivery|Leve/i],
  [
    "製作・レシピ",
    /Recipe|Craft|Synthesis|CompanyCraft|SubmarinePart|AirshipPart/i,
  ],
  ["採集・釣り", /Gather|Fish|Spearfish|Aquarium|AetherialReduce/i],
  [
    "ショップ・交換・通貨",
    /Shop|Gil|Currency|Exchange|SpecialShop|InclusionShop|TopicSelect/i,
  ],
  [
    "装備・性能・強化",
    /Item|Equip|BaseParam|Materia|Stain|Dye|Repair|Desynth|Relic/i,
  ],
  ["クエスト・報酬・実績", /Quest|Reward|Achievement|Fate/i],
  ["コンテンツ", /Content|Instance|Dungeon|Raid|PvP|DeepDungeon|DynamicEvent/i],
  ["NPC・モンスター", /ENpc|BNpc|Npc|Monster|Mob|Notorious/i],
  [
    "場所・マップ・移動",
    /Territory|PlaceName|Map|Aetheryte|Level|Warp|Weather/i,
  ],
  ["ジョブ・アクション", /^(ClassJob|Action|Status|Trait|Job|Role)/i],
  ["ハウジング", /Housing|Furniture|Yard|Indoor|Outdoor/i],
];

const INFORMATION_DESCRIPTIONS = new Map([
  ["Item", "名称・説明・分類・装備条件・基本性能などのアイテム基礎情報"],
  ["Recipe", "完成品、必要素材、数量、製作条件などのレシピ情報"],
  ["SatisfactionNpc", "お得意様取引のNPC、開放条件、週上限、納品候補アイテム"],
  ["Quest", "クエストの確定・選択報酬、触媒アイテム、開放条件"],
  ["QuestClassJobReward", "クラス／ジョブ別のクエスト報酬・要求アイテムと数量"],
  ["QuestClassJobSupply", "クラス／ジョブクエストの納品アイテム、数量、NPC"],
  [
    "QuestDefineClient",
    "クエスト定義値として参照され、行IDの存在先からItemと判定できる情報",
  ],
  ["CollectablesShopItem", "収集品取引の納品対象、収集価値、報酬・開放条件"],
  ["CollectablesShopRewardItem", "収集品取引の報酬アイテムと報酬段階"],
  ["DisposalShopItem", "廃品・復興系ショップの引渡品、受取品、数量、HQ条件"],
  ["FccShop", "カンパニークレジット交換品、必要クレジット、FCランク"],
  ["GCScripShopItem", "軍票交換品、必要軍票、必要グランドカンパニー階級"],
  ["GilShopItem", "ギルショップ販売品、HQ有無、クエスト・実績等の販売条件"],
  ["SpecialShop", "特殊交換の受取品・要求品・数量・収集価値・開放条件"],
  [
    "SatisfactionSupply",
    "お得意様取引の納品対象、収集価値段階、報酬、ボーナス率",
  ],
  ["AetherialWheel", "エーテリアルホイールの未充填品・充填品、等級、必要時間"],
  [
    "BannerCondition",
    "ポートレート／アドベンチャラープレート要素のアイテム開放条件",
  ],
  ["GardeningSeed", "栽培用種・植木鉢用種と表示・モデル情報"],
  ["GCSupplyDuty", "調達任務・補給品調達の対象アイテムと要求数量"],
  ["MJIGardenscaping", "無人島ガーデン関連の通常Item参照と開放レベル"],
  [
    "RetainerTaskNormal",
    "リテイナーベンチャーで入手できるアイテムと取得数量段階",
  ],
  ["VaseFlower", "花瓶に飾れる花アイテムとの対応"],
  ["HousingFurniture", "調度品アイテムの設置・撤去・ショップ会話等への参照"],
  ["HousingPreset", "ハウジング外装・内装セットを構成するアイテム"],
  ["HousingYardObject", "庭具アイテムの設置・撤去・木人等への参照"],
  ["AquariumFish", "水槽に入れられる魚アイテム、水槽水タイプ等の情報"],
  ["FishingBaitParameter", "釣り餌として扱われるアイテム"],
  ["FishingNoteInfo", "魚アイテムのサイズ、水槽、天候・時間制限、収集品情報"],
  ["GatheringItem", "採集対象と採集データを結ぶ情報"],
  [
    "HWDGathererInspection",
    "イシュガルド復興の採集検品対象・受取品・数量・報酬段階",
  ],
  ["FishingSpot", "釣り場の対象アイテム、エリア、座標、釣り場レベル"],
  ["GatheringPoint", "採集ポイントと場所・採集条件を結ぶ情報"],
  ["GatheringPointBase", "採集ポイントに配置される採集対象群"],
  ["GatheringPointTransient", "時刻・天候など採集ポイントの追加条件"],
  ["FishParameter", "魚の釣り条件・図鑑・分解などに関する情報"],
  ["SpearfishingItem", "刺突漁対象に関する情報"],
  [
    "BankaCraftWorksSupply",
    "ワチュメキメキ万貨街取引の納品アイテム、収集価値、経験値・ギル・スクリップ",
  ],
  ["CompanyCraftDraft", "カンパニークラフト設計図の開放要求アイテムと数量"],
  ["CompanyCraftSupplyItem", "カンパニークラフト工程で供給する通常アイテム"],
  ["CraftLeve", "製作リーヴの納品アイテム、数量、リーヴ・会話への参照"],
  ["HugeCraftworksNpc", "大規模製作系NPCの要求アイテム・数量と報酬アイテム"],
  ["HWDCrafterSupply", "イシュガルド復興の製作納品、収集価値、報酬、対象期間"],
  [
    "SharlayanCraftWorksSupply",
    "シャーレアン魔法大学取引の納品アイテム、収集価値、各種報酬",
  ],
  [
    "AnimaWeapon5TradeItem",
    "アニマウェポン用クリスタルサンド交換品・数量・HQ条件",
  ],
  ["ArchiveItem", "だいじなもの風のアーカイブ分類に対応する通常アイテム"],
  ["BuddyItem", "バディ関連で使用されるアイテム"],
  ["DailySupplyItem", "友好部族等の日次納品・支給枠に設定されたアイテム"],
  ["FurnitureCatalogItemList", "調度品カタログに掲載されるアイテムとカテゴリ"],
  ["GcArmyEquipPreset", "冒険者小隊の装備プリセットを構成するアイテム"],
  ["ItemRepairResource", "修理に使用するダークマター等のアイテム"],
  ["LeveRewardItemGroup", "リーヴ報酬候補アイテムと報酬グループ"],
  ["MirageStoreSetItem", "愛蔵品キャビネット等の装備セットを構成するアイテム"],
  ["RacingChocoboItem", "レーシングチョコボ関連アイテム"],
  ["Stain", "染色カラーデータと対応するカララントアイテム"],
  ["TomestonesItem", "アラガントームストーン種別と対応するItem行"],
  ["WKSItemInfo", "コスモエクスプローラー関連アイテムとサブカテゴリ"],
  ["YardCatalogItemList", "庭具カタログに掲載されるアイテムとカテゴリ"],
  ["WarpLogic", "ワープ処理引数のItem参照候補。複数型のため個別判定が必要"],
  ["ItemAction", "使用時効果などアイテムアクションに関する情報"],
  ["ItemFood", "食事・薬品等によるパラメータ補正情報"],
  ["ItemLevel", "アイテムレベルごとの性能基準値"],
  ["ItemUICategory", "アイテムのUI分類名"],
  ["ItemSearchCategory", "アイテム検索カテゴリ名"],
  ["EquipSlotCategory", "装備可能部位"],
  ["ClassJobCategory", "装備・使用可能なクラス／ジョブ"],
  ["BaseParam", "ステータス項目の名称と性質"],
  ["Materia", "マテリア化されるステータスと等級"],
  ["AetherialReduce", "精選結果に関する情報"],
  ["Desynthesis", "分解に関する情報"],
]);

function classifySheet(sheet) {
  return (
    CATEGORY_RULES.find(([, pattern]) => pattern.test(sheet))?.[0] ?? "その他"
  );
}

function describeSheet(sheet) {
  return (
    INFORMATION_DESCRIPTIONS.get(sheet) ??
    `${sheet}シートに記録された関連情報（意味の個別検証が必要）`
  );
}

function createReferenceResolver(schema) {
  return (header) => {
    const definition = schema?.columns.get(header);
    if (!definition || definition.targets.length === 0) return null;
    return {
      targetSheets: definition.targets,
      condition: definition.condition,
      confidence:
        definition.targets.length === 1 || definition.condition
          ? "verified"
          : "candidate",
      reason:
        definition.targets.length === 1 || definition.condition
          ? "EXDSchemaのlink定義"
          : "EXDSchemaの複数参照先候補（種別条件なし）",
      comment: definition.comment,
    };
  };
}

function createColumn(name, reference) {
  return {
    name,
    reference,
    nonEmptyCount: 0,
    numericCount: 0,
    numericAbove1000Count: 0,
    targetMatchCount: 0,
    itemTargetMatchCount: 0,
    itemCandidateMatchCount: 0,
    targetMatchSamples: [],
    valueSamples: [],
    numericMin: null,
    numericMax: null,
    distinctValues: new Set(),
    distinctValuesTruncated: false,
  };
}

function inspectValue(column, rawValue, targets, config) {
  const value = rawValue ?? "";
  if (value === "") return;
  column.nonEmptyCount += 1;
  if (
    column.valueSamples.length < config.sampleValueLimit &&
    !column.valueSamples.includes(value)
  ) {
    column.valueSamples.push(value);
  }
  if (!column.distinctValuesTruncated) {
    column.distinctValues.add(value);
    if (column.distinctValues.size > config.distinctValueLimit) {
      column.distinctValues.clear();
      column.distinctValuesTruncated = true;
    }
  }
  if (!/^-?\d+$/.test(value)) return;
  const numeric = Number(value);
  column.numericCount += 1;
  if (numeric > 1000) column.numericAbove1000Count += 1;
  column.numericMin =
    column.numericMin === null ? numeric : Math.min(column.numericMin, numeric);
  column.numericMax =
    column.numericMax === null ? numeric : Math.max(column.numericMax, numeric);
  if (targets.has(value)) {
    column.targetMatchCount += 1;
    if (
      column.targetMatchSamples.length < config.sampleValueLimit &&
      !column.targetMatchSamples.includes(value)
    ) {
      column.targetMatchSamples.push(value);
    }
  }
}

function serializeColumn(column) {
  return {
    name: column.name,
    reference: column.reference,
    nonEmptyCount: column.nonEmptyCount,
    numericCount: column.numericCount,
    numericAbove1000Count: column.numericAbove1000Count,
    numericMin: column.numericMin,
    numericMax: column.numericMax,
    distinctValueCount: column.distinctValuesTruncated
      ? `>${column.distinctValues.size}`
      : column.distinctValues.size,
    distinctValuesTruncated: column.distinctValuesTruncated,
    targetMatchCount: column.targetMatchCount,
    itemTargetMatchCount: column.itemTargetMatchCount,
    itemCandidateMatchCount: column.itemCandidateMatchCount,
    targetMatchSamples: column.targetMatchSamples,
    valueSamples: column.valueSamples,
  };
}

function resolveReferenceTargets(
  reference,
  header,
  headers,
  row,
  value,
  keySets,
) {
  if (!reference) return { targets: [], confidence: null };
  if (!reference.condition) {
    if (reference.targetSheets.length === 1)
      return { targets: reference.targetSheets, confidence: "verified" };
    const existingTargets = reference.targetSheets.filter((target) =>
      keySets.get(target)?.has(value),
    );
    return existingTargets.length === 1
      ? { targets: existingTargets, confidence: "verified" }
      : {
          targets:
            existingTargets.length > 0
              ? existingTargets
              : reference.targetSheets,
          confidence: "candidate",
        };
  }
  const switchName = reference.condition.switch;
  const prefix = header.includes(".")
    ? header.slice(0, header.lastIndexOf(".") + 1)
    : "";
  const switchHeaders = [`${prefix}${switchName}`, switchName];
  const switchIndex = switchHeaders
    .map((candidate) => headers.indexOf(candidate))
    .find((index) => index >= 0);
  if (switchIndex === undefined)
    return { targets: [], confidence: "unresolved" };
  const selected = reference.condition.cases?.[String(row[switchIndex] ?? "")];
  return {
    targets: Array.isArray(selected) ? selected : selected ? [selected] : [],
    confidence: "verified",
  };
}

async function inventoryCsv(file, schema, targets, keySets, config) {
  const sheet = path.basename(file.name, ".csv");
  const resolveReference = createReferenceResolver(schema);
  let headers = null;
  let columns = null;
  let rowCount = 0;
  let malformedRowCount = 0;
  let relevantRowCount = 0;
  let verifiedRelevantRowCount = 0;
  let candidateRelevantRowCount = 0;

  for await (const row of parseCsvFile(path.join(csvRoot, file.name))) {
    if (!headers) {
      headers = row;
      columns = headers.map((header) =>
        createColumn(header, resolveReference(header)),
      );
      continue;
    }
    if (row.length === 1 && row[0] === "") continue;
    rowCount += 1;
    if (row.length !== headers.length) malformedRowCount += 1;
    let relevant = sheet === "Item" && targets.has(row[0]);
    let verifiedRelevant = relevant;
    let candidateRelevant = false;
    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index];
      const value = row[index] ?? "";
      inspectValue(column, value, targets, config);
    }
    if (sheet !== "Item") {
      for (let index = 0; index < columns.length; index += 1) {
        const column = columns[index];
        const value = row[index] ?? "";
        if (
          !targets.has(value) ||
          !column.reference?.targetSheets.includes("Item")
        )
          continue;
        const resolved = resolveReferenceTargets(
          column.reference,
          column.name,
          headers,
          row,
          value,
          keySets,
        );
        if (!resolved.targets.includes("Item")) continue;
        relevant = true;
        if (resolved.confidence === "verified") {
          verifiedRelevant = true;
          column.itemTargetMatchCount += 1;
        } else {
          candidateRelevant = true;
          column.itemCandidateMatchCount += 1;
        }
      }
    }
    if (relevant) relevantRowCount += 1;
    if (verifiedRelevant) verifiedRelevantRowCount += 1;
    if (candidateRelevant && !verifiedRelevant) candidateRelevantRowCount += 1;
  }

  const serializedColumns = (columns ?? []).map(serializeColumn);
  const itemReferences = serializedColumns
    .filter((column) => column.reference?.targetSheets.includes("Item"))
    .filter(
      (column) =>
        column.itemTargetMatchCount > 0 || column.itemCandidateMatchCount > 0,
    )
    .map((column) => ({
      column: column.name,
      confidence: column.itemTargetMatchCount > 0 ? "verified" : "candidate",
      reason: column.reference.reason,
      targetMatchCount:
        column.itemTargetMatchCount + column.itemCandidateMatchCount,
      samples: column.targetMatchSamples,
    }));
  if (sheet === "Item") {
    itemReferences.unshift({
      column: "#",
      confidence: "verified",
      reason: "Item.csvの行キー",
      targetMatchCount: relevantRowCount,
      samples: serializedColumns[0]?.targetMatchSamples ?? [],
    });
  }
  const unresolvedItemCandidates = serializedColumns
    .filter(
      (column) =>
        !column.reference &&
        column.numericAbove1000Count > 0 &&
        column.targetMatchCount >= 10,
    )
    .filter(
      (column) =>
        column.targetMatchCount / Math.max(1, column.numericCount) >= 0.8,
    )
    .map((column) => ({
      column: column.name,
      targetMatchCount: column.targetMatchCount,
      numericCount: column.numericCount,
      samples: column.targetMatchSamples,
    }));

  return {
    sheet,
    file: file.name,
    bytes: file.size,
    blobSha: file.sha,
    rowCount,
    columnCount: headers?.length ?? 0,
    malformedRowCount,
    relevantRowCount,
    verifiedRelevantRowCount,
    candidateRelevantRowCount,
    itemReferences,
    unresolvedItemCandidates,
    schemaFile: schema?.file ?? null,
    schemaColumnCount: schema?.columns.size ?? 0,
    columnsWithoutSchema: serializedColumns
      .filter(
        (column) => column.name !== "#" && !schema?.columns.has(column.name),
      )
      .map((column) => column.name),
    columns: serializedColumns,
  };
}

async function buildAmbiguousKeySets(schemas, manifest, targets, reporter) {
  const requiredSheets = new Set(["Item"]);
  for (const schema of schemas.values()) {
    for (const column of schema.columns.values()) {
      if (column.targets.includes("Item") && column.targets.length > 1) {
        for (const target of column.targets) requiredSheets.add(target);
      }
    }
  }
  const fileBySheet = new Map(
    manifest.files.map((file) => [path.basename(file.name, ".csv"), file]),
  );
  const keySets = new Map([["Item", targets]]);
  const sheets = [...requiredSheets].filter((sheet) => sheet !== "Item");
  reporter.setStage("複数参照先を識別", sheets.length);
  for (let index = 0; index < sheets.length; index += 1) {
    const sheet = sheets[index];
    reporter.update({ current: sheet, completed: index });
    const file = fileBySheet.get(sheet);
    if (!file) continue;
    const keys = new Set();
    let first = true;
    for await (const row of parseCsvFile(path.join(csvRoot, file.name))) {
      if (first) {
        first = false;
        continue;
      }
      if (row[0] !== "") keys.add(row[0]);
    }
    keySets.set(sheet, keys);
    reporter.update({ completed: index + 1 });
  }
  return keySets;
}

function buildDependencyPaths(inventories, relationDepth) {
  const bySheet = new Map(
    inventories.map((inventory) => [inventory.sheet, inventory]),
  );
  const adjacency = new Map();
  for (const inventory of inventories) {
    const edgeMap = new Map();
    for (const column of inventory.columns) {
      for (const target of column.reference?.targetSheets ?? []) {
        if (target === inventory.sheet || !bySheet.has(target)) continue;
        const key = `${inventory.sheet}\0${target}`;
        const edge = {
          from: inventory.sheet,
          column: column.name.replace(/\[\d+\]/g, "[*]"),
          to: target,
          confidence: column.reference.confidence,
          reason: column.reference.reason,
        };
        const existing = edgeMap.get(key);
        if (
          !existing ||
          (existing.confidence !== "verified" && edge.confidence === "verified")
        ) {
          edgeMap.set(key, edge);
        }
      }
    }
    adjacency.set(inventory.sheet, [...edgeMap.values()]);
  }

  const roots = inventories.filter(
    (inventory) =>
      inventory.itemReferences.length > 0 && inventory.relevantRowCount > 0,
  );
  const dependencies = [];
  for (const root of roots) {
    const reached = new Set([root.sheet]);
    const queue = [
      { sheet: root.sheet, edges: [], visited: new Set([root.sheet]) },
    ];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current.edges.length >= relationDepth) continue;
      for (const edge of adjacency.get(current.sheet) ?? []) {
        if (current.visited.has(edge.to)) continue;
        const edges = [...current.edges, edge];
        if (reached.has(edge.to)) continue;
        reached.add(edge.to);
        dependencies.push({
          rootSheet: root.sheet,
          targetSheet: edge.to,
          edges,
        });
        queue.push({
          sheet: edge.to,
          edges,
          visited: new Set([...current.visited, edge.to]),
        });
      }
    }
  }
  return dependencies;
}

function compactColumnPatterns(references) {
  return [
    ...new Set(
      references.map((reference) =>
        reference.column.replace(/\[\d+\]/g, "[*]"),
      ),
    ),
  ];
}

function markdownEscape(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function createObtainableDataReport(result) {
  const lines = [
    "# 対象アイテムについて取得可能な情報",
    "",
    `- CSVコミット: \`${result.source.commit}\``,
    `- EXDSchemaコミット: \`${result.source.schemaCommit}\``,
    `- 対象アイテム: ${result.targets.targetCount.toLocaleString("ja-JP")}件`,
    `- レシピ完成品: ${result.targets.recipeResultCount.toLocaleString("ja-JP")}件`,
    `  - XIVAPI通常レシピ: ${result.targets.xivapiRecipeResultCount.toLocaleString("ja-JP")}件`,
    `  - Item.json側の交換レシピ: ${result.targets.appOnlyRecipeResultCount.toLocaleString("ja-JP")}件`,
    `- レシピを持たない使用素材: ${result.targets.ingredientWithoutRecipeCount.toLocaleString("ja-JP")}件`,
    `- 対象アイテムを直接参照するCSV: ${result.directSheets.length.toLocaleString("ja-JP")}件`,
    `  - 型と行IDから確定: ${result.directSheets.filter((sheet) => sheet.confidence === "verified").length.toLocaleString("ja-JP")}件`,
    `  - 複数参照先のため候補: ${result.directSheets.filter((sheet) => sheet.confidence === "candidate").length.toLocaleString("ja-JP")}件`,
    "",
    "このレポートは、対象アイテムを直接参照しているCSVを1件ずつ説明します。各行の文章は「このCSVを追加すると、対象アイテムについて何が分かるか」という意味です。Item参照とCSV間参照は、CSV生成器が使用するEXDSchemaの型定義に基づきます。",
    "",
  ];
  const grouped = Map.groupBy(result.directSheets, (item) => item.category);
  for (const [category, sheets] of grouped) {
    lines.push(
      `## ${category}`,
      "",
      "| CSV | このCSVを追加すると分かること | Item参照列 | 該当行 | 判定 | 次に結合できるCSV |",
      "| --- | --- | --- | ---: | --- | --- |",
    );
    for (const sheet of sheets) {
      lines.push(
        `| ${markdownEscape(sheet.sheet)} | 対象アイテムについて、${markdownEscape(sheet.description)}が分かります。 | ${markdownEscape(sheet.itemReferencePatterns.join(", "))} | ${sheet.relevantRowCount.toLocaleString("ja-JP")} | ${sheet.confidence} | ${markdownEscape(sheet.relatedSheets.join(", ") || "なし")} |`,
      );
    }
    lines.push("");
  }
  const additional = result.manualReviews.filter(
    (finding) => finding.classification !== "excluded",
  );
  lines.push(
    "## EXDSchema未定義の追加所見",
    "",
    "| CSV | 列 | 分かる可能性があること | 判定 | 根拠 |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const finding of additional) {
    lines.push(
      `| ${markdownEscape(finding.sheet)} | ${markdownEscape(finding.column)} | ${markdownEscape(finding.information ?? "-")} | ${finding.classification} | ${markdownEscape(finding.reason)} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function createDependenciesReport(result) {
  const lines = [
    "# CSV結合経路",
    "",
    `最大${result.config.relationDepth}段階まで、対象Itemを直接参照するCSVからEXDSchemaのlink定義に基づく最短参照経路を列挙しています。`,
    "",
    "| 起点CSV | 結合経路 | 判定 |",
    "| --- | --- | --- |",
  ];
  for (const dependency of result.dependencies) {
    const route = dependency.edges
      .map((edge) => `${edge.from}.${edge.column} → ${edge.to}.#`)
      .join(" → ");
    const confidence = dependency.edges.every(
      (edge) => edge.confidence === "verified",
    )
      ? "verified"
      : "candidate";
    lines.push(
      `| ${markdownEscape(dependency.rootSheet)} | ${markdownEscape(route)} | ${confidence} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function createCapabilityReport(result) {
  const lines = [
    "# CSVを追加すると、対象アイテムについて何が分かるか",
    "",
    `CSVコミット \`${result.source.commit}\` とEXDSchemaコミット \`${result.source.schemaCommit}\` に基づく調査結果です。対象は、レシピがあるアイテムと、その製作に使われる全アイテムです。`,
    "",
    "## 読み方",
    "",
    "たとえばレシピ情報なら、まず `Recipe.csv` を追加すると、対象アイテムが完成品か素材か、必要数と完成数が分かります。さらに `CraftType.csv` を結合すると製作ジョブ名、`RecipeLevelTable.csv` を結合すると製作レベルや難易度が分かります。以下では、すべての情報をこの形で説明します。",
    "",
    "CSV名を並べただけの技術資料は `csv-dependencies.md`、対象Itemを直接参照するCSV 1件ごとの一覧は `obtainable-data.md` に分けています。",
    "",
  ];
  for (const capability of result.capabilities) {
    const csv = capability.csv
      .map((sheet) =>
        capability.missingCsv.includes(sheet) ? `${sheet}（未取得）` : sheet,
      )
      .join(", ");
    lines.push(
      `## ${markdownEscape(capability.title)}`,
      "",
      markdownEscape(capability.explanation),
      "",
      `- 使用するCSV: ${markdownEscape(csv)}`,
      `- 結合の方向: ${markdownEscape(capability.joinPath)}`,
      `- 確認状況: ${capability.confidence === "verified" ? "参照関係を確認済み" : capability.confidence === "partial" ? "主な参照関係は確認済み。一部に追加検証が必要" : "候補。Item参照の確定が必要"}`,
      `- 注意点: ${markdownEscape(capability.notes)}`,
      "",
    );
  }
  lines.push(
    "## 確認状況の意味",
    "",
    "- `verified`: EXDSchemaの型とCSVの実データで参照関係を確認できる。",
    "- `partial`: 主経路は確認できるが、逆引き・サブ行キー・値の意味などに追加検証が残る。",
    "- `candidate`: 参照先が複数候補で、CSVだけではItem参照を確定できない。",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function createUnresolvedReport(result) {
  const lines = [
    "# EXDSchema未定義列の確認結果",
    "",
    "対象Item IDとの一致率が高い一方、EXDSchemaにItemリンクがない列を個別確認した結果です。",
    "",
    "| CSV | 列 | 判定 | 分かる可能性があること | 根拠 | 一致件数 |",
    "| --- | --- | --- | --- | --- | ---: |",
  ];
  for (const finding of result.manualReviews) {
    lines.push(
      `| ${markdownEscape(finding.sheet)} | ${markdownEscape(finding.column)} | ${finding.classification} | ${markdownEscape(finding.information ?? "-")} | ${markdownEscape(finding.reason)} | ${finding.targetMatchCount.toLocaleString("ja-JP")} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function wildcardPattern(pattern) {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("\\[\\*\\]", "\\[\\d+\\]");
  return new RegExp(`^${escaped}$`);
}

async function validateRecipeLookup(targetIds) {
  const recipeResults = new Map();
  const uniqueResults = new Set();
  let headers = null;
  for await (const row of parseCsvFile(path.join(csvRoot, "Recipe.csv"))) {
    if (!headers) {
      headers = row;
      continue;
    }
    const resultId = row[headers.indexOf("ItemResult")];
    recipeResults.set(row[0], resultId);
    if (resultId && resultId !== "0") uniqueResults.add(resultId);
  }
  let lookupHeaders = null;
  let checked = 0;
  let mismatches = 0;
  for await (const row of parseCsvFile(
    path.join(csvRoot, "RecipeLookup.csv"),
  )) {
    if (!lookupHeaders) {
      lookupHeaders = row;
      continue;
    }
    for (const recipeId of row.slice(1)) {
      if (!recipeId || recipeId === "0") continue;
      checked += 1;
      if (recipeResults.get(recipeId) !== row[0]) mismatches += 1;
    }
  }
  const targetResultCount = [...uniqueResults].filter((id) =>
    targetIds.has(id),
  ).length;
  return {
    checked,
    mismatches,
    uniqueResultCount: uniqueResults.size,
    targetResultCount,
    resultsOutsideTarget: uniqueResults.size - targetResultCount,
    passed:
      checked > 0 &&
      mismatches === 0 &&
      uniqueResults.size === targetResultCount,
  };
}

async function buildManualReviews(definitions, inventories, targetIds) {
  const bySheet = new Map(
    inventories.map((inventory) => [inventory.sheet, inventory]),
  );
  const recipeLookupValidation = await validateRecipeLookup(targetIds);
  return definitions.map((definition) => {
    const inventory = bySheet.get(definition.sheet);
    const pattern = wildcardPattern(definition.column);
    const matchingColumns =
      inventory?.columns.filter((column) => pattern.test(column.name)) ?? [];
    const review = {
      ...definition,
      targetMatchCount: matchingColumns.reduce(
        (sum, column) => sum + column.targetMatchCount,
        0,
      ),
      matchingColumnCount: matchingColumns.length,
    };
    if (definition.sheet === "RecipeLookup" && definition.column === "#") {
      review.validation = recipeLookupValidation;
      if (!recipeLookupValidation.passed) review.classification = "candidate";
    }
    return review;
  });
}

export async function runAnalysis(config, reporter) {
  const manifest = readJson(manifestPath);
  if (
    !manifest?.commit ||
    !Array.isArray(manifest.files) ||
    !manifest.schemas?.commit
  ) {
    throw new Error(
      "取得マニフェストがありません。先に download を実行してください。",
    );
  }
  const schemas = loadSchemas(schemaRoot);
  const capabilityDefinitions = readJson(capabilityConfigPath);
  const manualReviewDefinitions = readJson(manualReviewConfigPath);
  const items = readJson(itemJsonPath);
  const targets = buildTargetItems(items);
  if (targets.missingFromItemJsonCount > 0) {
    reporter.warning(
      `Item.jsonに存在しない素材IDが${targets.missingFromItemJsonCount}件あります`,
    );
  }
  ensureDirectory(cacheRoot);
  ensureDirectory(outputRoot);
  ensureDirectory(reportsRoot);

  const targetOutput = {
    generatedAt: new Date().toISOString(),
    sourceItemJson: "site/data/Item.json",
    itemJsonCount: targets.itemJsonCount,
    recipeResultCount: targets.recipeResultCount,
    ingredientCount: targets.ingredientCount,
    ingredientWithoutRecipeCount: targets.ingredientWithoutRecipeCount,
    targetCount: targets.targetCount,
    missingFromItemJsonCount: targets.missingFromItemJsonCount,
    items: targets.targetItems,
  };
  writeJsonAtomic(path.join(cacheRoot, "target-items.json"), targetOutput);

  const inventories = [];
  const keySets = await buildAmbiguousKeySets(
    schemas,
    manifest,
    targets.targetIds,
    reporter,
  );
  const targetFingerprint = crypto
    .createHash("sha256")
    .update(
      [...targets.targetIds]
        .sort((left, right) => Number(left) - Number(right))
        .join(","),
    )
    .digest("hex");
  const inventoryCacheRoot = path.join(cacheRoot, "inventory");
  ensureDirectory(inventoryCacheRoot);
  reporter.setStage("全CSVを棚卸し", manifest.files.length);
  for (let index = 0; index < manifest.files.length; index += 1) {
    const file = manifest.files[index];
    reporter.update({ current: file.name, completed: index });
    const cachePath = path.join(inventoryCacheRoot, `${file.name}.json`);
    const cached = readJson(cachePath, null);
    const inventory =
      cached?.sourceCommit === manifest.commit &&
      cached?.schemaCommit === manifest.schemas.commit &&
      cached?.analysisCacheVersion === ANALYSIS_CACHE_VERSION &&
      cached?.blobSha === file.sha &&
      cached?.targetFingerprint === targetFingerprint
        ? cached.inventory
        : await inventoryCsv(
            file,
            schemas.get(path.basename(file.name, ".csv")),
            targets.targetIds,
            keySets,
            config,
          );
    inventories.push(inventory);
    if (cached?.inventory !== inventory) {
      writeJsonAtomic(cachePath, {
        sourceCommit: manifest.commit,
        schemaCommit: manifest.schemas.commit,
        analysisCacheVersion: ANALYSIS_CACHE_VERSION,
        blobSha: file.sha,
        targetFingerprint,
        inventory,
      });
    }
    reporter.update({ completed: index + 1 });
  }

  reporter.setStage("参照経路を解析", inventories.length);
  const dependencies = buildDependencyPaths(inventories, config.relationDepth);
  const directSheets = inventories
    .filter(
      (inventory) =>
        inventory.itemReferences.length > 0 && inventory.relevantRowCount > 0,
    )
    .map((inventory) => ({
      sheet: inventory.sheet,
      category: classifySheet(inventory.sheet),
      description: describeSheet(inventory.sheet),
      relevantRowCount: inventory.relevantRowCount,
      verifiedRelevantRowCount: inventory.verifiedRelevantRowCount,
      candidateRelevantRowCount: inventory.candidateRelevantRowCount,
      itemReferenceColumnCount: inventory.itemReferences.length,
      itemReferencePatterns: compactColumnPatterns(inventory.itemReferences),
      confidence: inventory.itemReferences.every(
        (reference) => reference.confidence === "verified",
      )
        ? "verified"
        : "candidate",
      relatedSheets: [
        ...new Set(
          inventory.columns
            .flatMap((column) => column.reference?.targetSheets ?? [])
            .filter(
              (target) => target !== "Item" && target !== inventory.sheet,
            ),
        ),
      ].sort(),
    }))
    .sort(
      (left, right) =>
        left.category.localeCompare(right.category, "ja") ||
        left.sheet.localeCompare(right.sheet, "en"),
    );
  const availableSheets = new Set(
    inventories.map((inventory) => inventory.sheet),
  );
  const manualReviews = await buildManualReviews(
    manualReviewDefinitions,
    inventories,
    targets.targetIds,
  );
  const recipeLookupValidation = manualReviews.find(
    (review) => review.sheet === "RecipeLookup" && review.column === "#",
  )?.validation;
  const appOnlyRecipeResultCount =
    targets.recipeResultCount -
    (recipeLookupValidation?.targetResultCount ?? 0);
  const capabilities = capabilityDefinitions.map((capability) => ({
    ...capability,
    notes:
      capability.id === "recipe"
        ? `${capability.notes} XIVAPI通常レシピは${recipeLookupValidation?.targetResultCount.toLocaleString("ja-JP")}完成品をカバーし、残る${appOnlyRecipeResultCount.toLocaleString("ja-JP")}件は現在のItem.json側の交換レシピである。`
        : capability.notes,
    missingCsv: capability.csv.filter((sheet) => !availableSheets.has(sheet)),
  }));

  const generatedAt = new Date().toISOString();
  const result = {
    generatedAt,
    source: {
      repository: manifest.repository,
      branch: manifest.branch,
      language: manifest.language,
      commit: manifest.commit,
      schemaRepository: manifest.schemas.repository,
      schemaBranch: manifest.schemas.branch,
      schemaCommit: manifest.schemas.commit,
      fetchedAt: manifest.fetchedAt,
      csvCount: manifest.fileCount,
      schemaCount: schemas.size,
    },
    config: { relationDepth: config.relationDepth },
    targets: {
      itemJsonCount: targets.itemJsonCount,
      recipeResultCount: targets.recipeResultCount,
      xivapiRecipeResultCount:
        recipeLookupValidation?.targetResultCount ?? null,
      appOnlyRecipeResultCount,
      ingredientCount: targets.ingredientCount,
      ingredientWithoutRecipeCount: targets.ingredientWithoutRecipeCount,
      targetCount: targets.targetCount,
      missingFromItemJsonCount: targets.missingFromItemJsonCount,
    },
    capabilities,
    manualReviews,
    directSheets,
    dependencies,
    inventories,
  };

  writeJsonAtomic(path.join(cacheRoot, "csv-inventory.json"), {
    generatedAt,
    sourceCommit: manifest.commit,
    inventories,
  });
  writeJsonAtomic(path.join(outputRoot, "analysis-result.json"), {
    ...result,
    dependencies: undefined,
    inventories: undefined,
  });
  writeTextAtomic(
    path.join(reportsRoot, "obtainable-data.md"),
    createObtainableDataReport(result),
  );
  writeTextAtomic(
    path.join(reportsRoot, "capability-map.md"),
    createCapabilityReport(result),
  );
  writeTextAtomic(
    path.join(reportsRoot, "csv-dependencies.md"),
    createDependenciesReport(result),
  );
  writeTextAtomic(
    path.join(reportsRoot, "unresolved-references.md"),
    createUnresolvedReport(result),
  );
  reporter.finish({
    completed: inventories.length,
    total: inventories.length,
    directSheetCount: directSheets.length,
  });
  return result;
}
