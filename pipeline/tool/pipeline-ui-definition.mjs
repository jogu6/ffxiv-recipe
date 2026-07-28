#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const definition = {
  schemaVersion: 1,
  application: {
    title: "FF14レシピ素材ツリー アイテム情報作成",
    idleStatus: "待機中",
  },
  sections: [
    {
      id: "data",
      toggleId: "csvToggle",
      bodyId: "csvBody",
      label: "データ更新",
      expanded: true,
    },
    {
      id: "icons",
      toggleId: "buildToggle",
      bodyId: "buildBody",
      label: "アイコン生成",
      expanded: false,
    },
    {
      id: "preview",
      toggleId: "iconQualityToggle",
      bodyId: "iconQualityBody",
      label: "プレビュー",
      expanded: false,
    },
  ],
  actions: [
    {
      id: "check-updates",
      section: "data",
      command: "check-updates",
      buttonId: "checkUpdatesBtn",
      order: "任意",
      label: "更新チェック",
      description:
        "公式 CSV の更新有無を確認し、前回チェック日時を保存します。",
      behavior: "command",
      args: [],
    },
    {
      id: "download-csv",
      section: "data",
      command: "download-csv",
      buttonId: "downloadCsvBtn",
      order: "任意",
      label: "CSV取得",
      description: "更新または不足している公式 CSV を取得します。",
      behavior: "command",
      confirm: "CSVをダウンロードします。通信が発生します。実行しますか？",
      args: [],
    },
    {
      id: "validate-csv",
      section: "data",
      command: "validate-csv",
      buttonId: "validateCsvBtn",
      order: "1",
      label: "CSV検証",
      description: "必須ヘッダーと token-items.csv の形式を確認します。",
      behavior: "command",
      args: [],
    },
    {
      id: "build",
      section: "data",
      command: "build",
      buttonId: "buildBtn",
      order: "2",
      label: "データ生成",
      description:
        "CSV から公開候補 JSON を作ります。まだ公開データは置き換えません。",
      behavior: "command",
      confirm: "データ生成には時間がかかる場合があります。実行しますか？",
      args: [],
      refreshEquipmentRole: true,
    },
    {
      id: "publish-lodestone-info",
      section: "data",
      command: "publish-lodestone-info",
      buttonId: "lodestoneInfoBtn",
      order: "4",
      label: "Lodestone情報反映",
      description:
        "店、製作、装備情報をLodestoneから取得し、ハウジング・友好部族ショップ情報とともに公開候補JSONへ反映します。",
      behavior: "command",
      confirm:
        "Lodestone情報とハウジング・友好部族ショップ情報を公開候補JSONに反映します。公開データはまだ置き換えません。時間がかかります。実行しますか？",
      args: [
        { flag: "--delay", inputId: "lodestoneDelayInput" },
        { flag: "--force", inputId: "lodestoneForceInput", type: "checkbox" },
      ],
      refreshEquipmentRole: true,
    },
    {
      id: "equipment-role-groups",
      section: "data",
      buttonId: "equipmentRoleBtn",
      order: "確認",
      label: "推奨ロール確認",
      description:
        "Lodestone情報反映後、判定不能な広域装備の推奨ロールを指定します。保存後、次回のLodestone情報反映で候補JSONへ反映されます。",
      behavior: "equipment-role-dialog",
    },
    {
      id: "publish",
      section: "data",
      command: "publish",
      buttonId: "publishBtn",
      order: "5",
      label: "公開反映",
      description:
        "現在の Item.json を自動保護し、候補データを site/data/Item.json に統合します。",
      behavior: "command",
      confirm: "検証後に site/data/Item.json を置き換えます。実行しますか？",
      args: [],
      refreshEquipmentRole: true,
    },
    {
      id: "run-all",
      section: "data",
      buttonId: "runBtn",
      order: "一括",
      label: "全実行",
      description:
        "CSV検証、データ生成、アイコン生成、Lodestone情報反映、公開反映を順番に実行します。",
      behavior: "sequence",
      confirm:
        "全実行はデータ生成、アイコン生成、Lodestone情報反映、公開反映を行います。時間がかかる場合があります。実行しますか？",
    },
    {
      id: "icons",
      section: "icons",
      command: "icons",
      buttonId: "iconsBtn",
      order: "3",
      label: "アイコン生成",
      description:
        "Lodestone NQ 画像を優先し、指定サイズの WebP アイコンを生成します。元 PNG はキャッシュします。",
      behavior: "command",
      confirm:
        "アイコン生成には時間がかかり、不足分は Lodestone または XIVAPI から取得します。実行しますか？",
      args: [
        { flag: "--quality", inputId: "qualityInput" },
        { flag: "--size", inputId: "iconSizeInput" },
        { flag: "--delay", inputId: "iconDelayInput" },
      ],
      sequenceArgs: [
        { flag: "--quality", inputId: "qualityInput" },
        { flag: "--size", inputId: "iconSizeInput" },
        { flag: "--delay", inputId: "iconDelayInput" },
        {
          flag: "--item-json",
          value: "pipeline/intermediate/06-public-items.json",
        },
      ],
    },
    {
      id: "verify",
      section: "icons",
      command: "verify",
      buttonId: "verifyBtn",
      order: "確認",
      label: "Item.json比較",
      description:
        "確認のみ。比較して結果を出しますが、Item.json は変更しません。",
      behavior: "command",
      args: [],
    },
    {
      id: "tmp-quality-preview",
      section: "preview",
      command: "tmp-quality-preview",
      buttonId: "previewBtn",
      order: "任意",
      label: "比較ページ生成",
      availableLabel: "比較ページ表示",
      description:
        "PNG と q50/q60/q70/q80 を並べた一時確認ページを作ります。生成サイズを反映します。",
      behavior: "quality-preview",
      confirm:
        "比較ページ生成には時間がかかり、不足PNGを通信で取得する場合があります。実行しますか？",
      availableConfirm: "作成済みの比較ページを表示します。実行しますか？",
      args: [{ flag: "--size", inputId: "previewSizeInput" }],
    },
  ],
  recommendedSequence: [
    "validate-csv",
    "build",
    "icons",
    "publish-lodestone-info",
    "publish",
  ],
  equipmentRoleLabels: {
    tank: "タンク",
    healer: "ヒーラー",
    striker_slayer: "ストライカー&スレイヤー",
    scout_ranger: "スカウト&レンジャー",
    caster: "キャスター",
    fighter: "ファイター",
    sorcerer: "ソーサラー",
  },
  chrome: {
    progressTitle: "進捗",
    progressIdle: "未実行",
    cancel: "中断",
    resume: "再開",
    clearLog: "クリア",
    confirmOk: "実行",
    confirmCancel: "キャンセル",
    previewTitle: "アイコン画質比較",
    previewClose: "閉じる",
    equipmentRoleTitle: "推奨ロール確認",
    equipmentRoleClose: "閉じる",
    equipmentRoleSave: "保存",
    resumeConfirm:
      "再開は安全な推奨順を再実行します。元画像キャッシュは再利用されます。実行しますか？",
  },
};

export function validatePipelineUiDefinition(value) {
  const errors = [];
  if (!value || typeof value !== "object")
    return ["UI definition must be an object."];
  if (value.schemaVersion !== 1) errors.push("schemaVersion must be 1.");
  if (!value.application?.title || !value.application?.idleStatus)
    errors.push("application title and idleStatus are required.");
  if (
    !value.equipmentRoleLabels ||
    Object.keys(value.equipmentRoleLabels).length === 0
  ) {
    errors.push("equipmentRoleLabels must be a non-empty object.");
  }
  if (!Array.isArray(value.sections) || value.sections.length === 0)
    errors.push("sections must be a non-empty array.");
  if (!Array.isArray(value.actions) || value.actions.length === 0)
    errors.push("actions must be a non-empty array.");

  const sectionIds = new Set();
  for (const section of value.sections || []) {
    if (!section?.id || sectionIds.has(section.id))
      errors.push(`Invalid or duplicate section id: ${section?.id || ""}`);
    sectionIds.add(section?.id);
    if (!section.toggleId || !section.bodyId || !section.label)
      errors.push(`Section ${section.id || ""} is incomplete.`);
  }

  const actionIds = new Set();
  const commands = new Set();
  const behaviors = new Set([
    "command",
    "equipment-role-dialog",
    "quality-preview",
    "sequence",
  ]);
  for (const action of value.actions || []) {
    if (!action?.id || actionIds.has(action.id))
      errors.push(`Invalid or duplicate action id: ${action?.id || ""}`);
    actionIds.add(action?.id);
    if (!sectionIds.has(action?.section))
      errors.push(
        `Unknown section for action ${action?.id || ""}: ${action?.section || ""}`,
      );
    if (
      !action?.buttonId ||
      !action?.label ||
      !action?.description ||
      !action?.order
    ) {
      errors.push(`Action ${action?.id || ""} is incomplete.`);
    }
    if (!behaviors.has(action?.behavior))
      errors.push(
        `Unknown behavior for action ${action?.id || ""}: ${action?.behavior || ""}`,
      );
    if (
      action?.behavior === "command" ||
      action?.behavior === "quality-preview"
    ) {
      if (!action.command || commands.has(action.command))
        errors.push(`Invalid or duplicate command: ${action.command || ""}`);
      commands.add(action.command);
    }
    for (const arg of [
      ...(action?.args || []),
      ...(action?.sequenceArgs || []),
    ]) {
      if (!arg?.flag || (!arg.inputId && typeof arg.value !== "string")) {
        errors.push(`Invalid argument mapping for action ${action?.id || ""}.`);
      }
    }
  }

  if (
    !Array.isArray(value.recommendedSequence) ||
    value.recommendedSequence.length === 0
  ) {
    errors.push("recommendedSequence must be a non-empty array.");
  } else {
    for (const command of value.recommendedSequence) {
      if (!commands.has(command))
        errors.push(`Unknown recommended command: ${command}`);
    }
  }
  return errors;
}

export function getPipelineUiDefinition() {
  const copy = JSON.parse(JSON.stringify(definition));
  const errors = validatePipelineUiDefinition(copy);
  if (errors.length)
    throw new Error(
      `Invalid pipeline UI definition:\n- ${errors.join("\n- ")}`,
    );
  return copy;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  process.stdout.write(`${JSON.stringify(getPipelineUiDefinition())}\n`);
}
