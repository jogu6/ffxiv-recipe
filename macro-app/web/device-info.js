const UNAVAILABLE = '取得不可';

async function optionalValue(read, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(read).catch(() => null),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); })
    ]);
  } finally { clearTimeout(timer); }
}

export async function collectDeviceInfo(nav = {}, timeoutMs = 1500) {
  const ua = nav.userAgent || '';
  const [hints, brave] = await Promise.all([
    optionalValue(() => nav.userAgentData?.getHighEntropyValues?.(['model', 'platformVersion', 'fullVersionList']), timeoutMs),
    optionalValue(() => nav.brave?.isBrave?.(), timeoutMs)
  ]);
  const brands = hints?.fullVersionList || nav.userAgentData?.brands || [];
  let name = UNAVAILABLE;
  let version = UNAVAILABLE;
  let source = '取得不可（非対応・非公開・取得失敗）';
  for (const [label, pattern] of [
    ['Microsoft Edge', /(?:EdgA|EdgiOS|Edg)\/([\d.]+)/],
    ['Opera', /(?:OPR|OPiOS)\/([\d.]+)/],
    ['Samsung Internet', /SamsungBrowser\/([\d.]+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/],
    ['Google Chrome（iOS）', /CriOS\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari\//],
    ['Chrome互換（製品名は判別不可）', /Chrome\/([\d.]+)/]
  ]) {
    const match = ua.match(pattern);
    if (match) { name = label; version = match[1]; source = 'User-Agentによる判別'; break; }
  }
  const known = ['Brave', 'Microsoft Edge', 'Opera', 'Samsung Internet', 'Google Chrome']
    .map(brand => brands.find(item => item.brand === brand)).find(Boolean);
  if (known) {
    name = known.brand; version = known.version || UNAVAILABLE;
    source = hints?.fullVersionList ? 'ブラウザー公開情報（詳細バージョン）' : 'ブラウザー公開情報（概略バージョン）';
  }
  if (brave === true || name === 'Brave') {
    name = 'Brave';
    // Brave's UA brand version can describe Chromium, not the Brave product release.
    version = UNAVAILABLE;
    source = brave === true ? 'Brave APIによる製品名判別' : 'ブラウザー公開情報による製品名判別';
  }
  if (version === UNAVAILABLE) {
    const detailed = hints?.fullVersionList?.find(item => item.brand === 'Chromium' && item.version);
    const brief = nav.userAgentData?.brands?.find(item => item.brand === 'Chromium' && item.version);
    const uaVersion = ua.match(/(?:Chrome|Chromium)\/([\d.]+)/)?.[1];
    const chromium = detailed?.version || brief?.version || uaVersion;
    if (chromium) {
      version = `Chromium ${chromium}（製品バージョンは取得不可）`;
      source += ` / 代替情報：${detailed ? 'Chromium詳細バージョン' : brief
        ? 'Chromium概略バージョン' : 'User-Agent（省略された値の可能性あり）'}`;
    }
  }
  return {
    ブラウザー名: name, ブラウザーバージョン: version, ブラウザー判別方法: source,
    UserAgent: ua || UNAVAILABLE,
    端末型番: hints?.model?.trim() || UNAVAILABLE,
    OS: hints?.platform || nav.userAgentData?.platform || UNAVAILABLE,
    OSバージョン: hints?.platformVersion || UNAVAILABLE,
    '論理プロセッサ数（ブラウザー公開値）': Number.isInteger(nav.hardwareConcurrency) && nav.hardwareConcurrency > 0
      ? nav.hardwareConcurrency : UNAVAILABLE,
    最大スレッド数: '取得不可（論理プロセッサ数は実機の最大値を保証しません）',
    '搭載RAM概算（GiB・ブラウザー公開値）': Number.isFinite(nav.deviceMemory) && nav.deviceMemory > 0
      ? nav.deviceMemory : UNAVAILABLE,
    現在の空きRAM: '取得不可', 確保可能RAM: '取得不可',
    メモリー値の注意: '搭載RAMは丸められた概算値であり、現在使用できるRAMではありません'
  };
}

export function collectScreenInfo(view) {
  let page = view;
  try { if (view.top?.document) page = view.top; } catch { /* 別オリジンの場合はパネルの値を使用 */ }
  return {
    '画面全体（CSS px）': { 幅: view.screen?.width ?? UNAVAILABLE, 高さ: view.screen?.height ?? UNAVAILABLE },
    'ページ表示領域（CSS px）': { 幅: page.innerWidth, 高さ: page.innerHeight },
    'パネル表示領域（CSS px）': { 幅: view.innerWidth, 高さ: view.innerHeight },
    ピクセル比: view.devicePixelRatio,
    '表示倍率（Visual Viewport）': page.visualViewport?.scale ?? UNAVAILABLE
  };
}
