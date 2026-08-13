#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const definition = {
  schemaVersion: 2,
  application: {
    title: "XIVca | Item.json作成",
    idleStatus: "待機中",
  },
  modules: [
    {
      id: "lodestone-item-json",
      schemaVersion: 2,
      order: 1,
      label: "Lodestone Item.json生成",
      description: "Lodestoneの最新一覧とレシピを取得し、画像を整備して公開用Item.jsonへ反映します。",
      settings: [
        {
          id: "network",
          type: "group",
          label: "Lodestone取得",
          accordion: true,
          expanded: true,
          children: [
            {
              id: "lodestone-delay",
              type: "number",
              label: "アクセス間隔",
              description: "Lodestoneと画像取得の共通直列キューに使います。",
              default: 100,
              min: 100,
              max: 60000,
              step: 100,
              unit: "ms",
              persist: true,
              required: true,
            },
          ],
        },
        {
          id: "images",
          type: "group",
          label: "アイテム画像",
          accordion: true,
          expanded: true,
          children: [
            {
              id: "webp-quality",
              type: "number",
              label: "WebPクオリティ",
              default: 80,
              min: 1,
              max: 100,
              step: 1,
              persist: true,
              required: true,
            },
            {
              id: "icon-size",
              type: "number",
              label: "生成サイズ",
              default: 80,
              min: 1,
              max: 512,
              step: 1,
              unit: "px",
              persist: true,
              required: true,
            },
          ],
        },
      ],
      actionGroups: [
        { id: "individual", label: "個別実行", order: 1 },
        { id: "complete", label: "一括実行", order: 2 },
      ],
      actions: [
        {
          id: "lodestone-audit",
          group: "individual",
          order: 1,
          command: "lodestone-audit",
          label: "1. Lodestone完全監査",
          description: "全一覧と全レシピ詳細を監査ID単位で直列取得し、差分レポートを保存します。",
          confirm: "Lodestone完全監査を指定間隔で直列取得します。実行しますか？",
          settingIds: ["lodestone-delay"],
          args: [{ flag: "--delay", settingId: "lodestone-delay" }],
          resume: "checkpoint",
        },
        {
          id: "build-lodestone-candidate",
          group: "individual",
          order: 2,
          command: "build-lodestone-candidate",
          label: "2. Item.json候補生成",
          description: "Lodestoneキャッシュと手動交換データから名前キー候補を生成します。",
          settingIds: ["lodestone-delay"],
          args: [{ flag: "--delay", settingId: "lodestone-delay" }],
          resume: "restart",
        },
        {
          id: "item-icon-cache",
          group: "individual",
          order: 3,
          command: "item-icon-cache",
          label: "3. ローカル画像キャッシュ準備",
          description: "公開画像パックを検証して展開し、pipeline/cache内の個別画像キャッシュを不足分だけ準備します。公開サイトは変更しません。",
          settingIds: [],
          args: [],
          resume: "restart",
        },
        {
          id: "lodestone-candidate-icons",
          group: "individual",
          order: 5,
          command: "lodestone-candidate-icons",
          label: "5. 画像整備・生成",
          description: "新規・不足画像を取得し、名前と内容ハッシュ形式のWebPへ整備します。",
          settingIds: ["lodestone-delay", "webp-quality", "icon-size"],
          args: [
            { flag: "--delay", settingId: "lodestone-delay" },
            { flag: "--quality", settingId: "webp-quality" },
            { flag: "--size", settingId: "icon-size" },
          ],
          resume: "checkpoint",
        },
        {
          id: "publish-lodestone-candidate",
          group: "individual",
          order: 6,
          command: "publish-lodestone-candidate",
          label: "6. Item.json公開反映",
          description: "構造と全画像を検証した候補だけをsite/data/Item.jsonへアトミックに反映し、画像パックとデータ・アプリキャッシュ版も更新します。",
          confirm: "検証済み候補を公開用Item.jsonへ反映します。実行しますか？",
          settingIds: [],
          args: [],
          resume: "restart",
        },
        {
          id: "item-icon-preview",
          group: "individual",
          order: 4,
          command: "tmp-quality-preview",
          label: "画像設定をプレビュー",
          description: "現在のWebPクオリティと生成サイズを代表画像で比較表示します。公開データは変更しません。",
          confirm: "代表画像の比較プレビューを生成します。未取得画像がある場合はLodestoneへの通信が発生します。実行しますか？",
          settingIds: ["lodestone-delay", "webp-quality", "icon-size"],
          args: [
            { flag: "--delay", settingId: "lodestone-delay" },
            { flag: "--quality", settingId: "webp-quality" },
            { flag: "--size", settingId: "icon-size" },
          ],
          resultView: {
            type: "quality-preview",
            title: "アイテム画像プレビュー",
            closeLabel: "閉じる",
          },
          resume: "restart",
        },
        {
          id: "item-icon-pack",
          group: "individual",
          order: 7,
          command: "item-icon-pack",
          label: "7. 公開画像パック再生成",
          description: "ローカル画像キャッシュから、現行Item.jsonに必要な全画像を一つの公開パックへ再生成します。",
          confirm: "公開画像パックとデータ・アプリキャッシュ版を更新します。実行しますか？",
          settingIds: [],
          args: [],
          resume: "restart",
        },
        {
          id: "share-code-plaza-icons",
          group: "individual",
          order: 8,
          command: "share-code-plaza-icons",
          label: "8. シェアコード広場画像同期",
          description: "掲載中のシェアコードだけが使う画像を、案内サイトの公開画像へ同期し、不要画像を除外します。",
          settingIds: [],
          args: [],
          resume: "restart",
        },
        {
          id: "item-icon-validate",
          group: "individual",
          order: 9,
          command: "item-icon-validate",
          label: "9. 公開画像パック検証",
          description: "公開画像パックの構造、内容ハッシュ、ファイル名、Item.jsonとの対応を検証します。",
          settingIds: [],
          args: [],
          resume: "restart",
        },
        {
          id: "app-cache-version",
          group: "individual",
          order: 10,
          command: "app-cache-version",
          label: "10. アプリキャッシュ版更新",
          description: "公開アプリ資産の内容からアプリキャッシュ版を再計算します。",
          settingIds: [],
          args: [],
          resume: "restart",
        },
        {
          id: "generate-item-json",
          group: "complete",
          order: 1,
          label: "最新Item.jsonを一括生成",
          description: "完全監査からItem.json・画像パック・シェアコード広場画像・キャッシュ版の反映と検証までを順番に実行します。完了済み工程は再開時に省略します。",
          confirm: "Lodestoneの最新情報からItem.jsonを一括生成します。長時間処理と通信が発生します。実行しますか？",
          settingIds: ["lodestone-delay", "webp-quality", "icon-size"],
          sequence: [
            "lodestone-audit",
            "build-lodestone-candidate",
            "item-icon-cache",
            "lodestone-candidate-icons",
            "publish-lodestone-candidate",
            "share-code-plaza-icons",
            "item-icon-validate",
          ],
          resume: "checkpoint",
        },
      ],
    },
  ],
  chrome: {
    progressTitle: "進捗",
    progressIdle: "未実行",
    cancel: "中止",
    resume: "続きから再開",
    clearLog: "クリア",
    resetSettings: "設定を初期値に戻す",
    confirmOk: "実行",
    confirmCancel: "キャンセル",
  },
};

const settingTypes = new Set(["checkbox", "number", "select", "text", "file", "directory", "range"]);

function validateCondition(condition, settingIds, context, errors) {
  if (!condition) return;
  if (!settingIds.has(condition.settingId)) errors.push(`${context}: unknown condition setting ${condition.settingId || ""}`);
  if (!["eq", "ne", "gt", "gte", "lt", "lte", "in"].includes(condition.operator)) {
    errors.push(`${context}: invalid condition operator ${condition.operator || ""}`);
  }
}

export function validatePipelineUiDefinition(value) {
  const errors = [];
  if (!value || typeof value !== "object") return ["UI definition must be an object."];
  if (value.schemaVersion !== 2) errors.push("schemaVersion must be 2.");
  if (!value.application?.title || !value.application?.idleStatus) errors.push("application title and idleStatus are required.");
  if (!Array.isArray(value.modules) || value.modules.length === 0) errors.push("modules must be a non-empty array.");
  const moduleIds = new Set();
  for (const module of value.modules || []) {
    const context = `module ${module?.id || ""}`;
    if (!module?.id || moduleIds.has(module.id)) errors.push(`Invalid or duplicate module id: ${module?.id || ""}`);
    moduleIds.add(module?.id);
    if (!Number.isInteger(module?.schemaVersion) || module.schemaVersion < 1 || !module?.label) errors.push(`${context} is incomplete.`);
    const nodeIds = new Set();
    const settingIds = new Set();
    const visit = (node, parent = context) => {
      if (!node?.id || nodeIds.has(node.id)) errors.push(`${parent}: invalid or duplicate node id ${node?.id || ""}`);
      nodeIds.add(node?.id);
      if (node?.type === "group") {
        if (!node.label || !Array.isArray(node.children)) errors.push(`${parent}/${node?.id || ""}: group is incomplete.`);
        for (const child of node.children || []) visit(child, `${parent}/${node.id}`);
        return;
      }
      if (!settingTypes.has(node?.type)) errors.push(`${parent}/${node?.id || ""}: invalid setting type ${node?.type || ""}`);
      if (!node?.label) errors.push(`${parent}/${node?.id || ""}: label is required.`);
      settingIds.add(node?.id);
    };
    for (const node of module?.settings || []) visit(node);
    for (const setting of (() => {
      const rows = [];
      const collect = node => node.type === "group" ? (node.children || []).forEach(collect) : rows.push(node);
      (module?.settings || []).forEach(collect);
      return rows;
    })()) {
      validateCondition(setting.visibleWhen, settingIds, `${context}/${setting.id}`, errors);
      validateCondition(setting.enabledWhen, settingIds, `${context}/${setting.id}`, errors);
    }
    const groupIds = new Set((module?.actionGroups || []).map(group => group.id));
    const actionIds = new Set();
    for (const action of module?.actions || []) {
      if (!action?.id || actionIds.has(action.id)) errors.push(`${context}: invalid or duplicate action id ${action?.id || ""}`);
      actionIds.add(action?.id);
      if (!action?.label || !action?.description || !groupIds.has(action?.group)) errors.push(`${context}/${action?.id || ""}: action is incomplete.`);
      if (!action.command && !Array.isArray(action.sequence)) errors.push(`${context}/${action?.id || ""}: command or sequence is required.`);
      for (const settingId of action?.settingIds || []) if (!settingIds.has(settingId)) errors.push(`${context}/${action.id}: unknown setting ${settingId}`);
      for (const mapping of action?.args || []) {
        if (!mapping?.flag || !settingIds.has(mapping?.settingId)) errors.push(`${context}/${action.id}: invalid argument mapping.`);
      }
      if (action?.resultView && action.resultView.type !== "quality-preview") errors.push(`${context}/${action.id}: invalid result view.`);
      validateCondition(action?.enabledWhen, settingIds, `${context}/${action.id}`, errors);
    }
    for (const action of module?.actions || []) {
      for (const childId of action?.sequence || []) if (!actionIds.has(childId)) errors.push(`${context}/${action.id}: unknown sequence action ${childId}`);
    }
  }
  return errors;
}

export function getPipelineUiDefinition() {
  const copy = JSON.parse(JSON.stringify(definition));
  const errors = validatePipelineUiDefinition(copy);
  if (errors.length) throw new Error(`Invalid pipeline UI definition:\n- ${errors.join("\n- ")}`);
  return copy;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.stdout.write(`${JSON.stringify(getPipelineUiDefinition())}\n`);
}
