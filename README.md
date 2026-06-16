# FFXIV Recipe Material Tree

FFXIVのレシピと必要素材をツリー表示する静的Webアプリです。

- 公開サイト: https://jogu6.github.io/ffxiv-recipe/
- GitHub Pagesで配信
- PWA対応
- データ生成処理はWindows 11上のPowerShellで実行

## Repository structure

```text
site/       GitHub Pagesへ公開するWebアプリ
pipeline/   CSV入力、生成途中のJSON、生成スクリプト、ログ
design/     アプリアイコンの原本と旧デザイン素材
docs/       開発・運用ドキュメント
tools/      環境構築、検証、リポジトリ操作用ツール
.github/    GitHub Actions
```

## Local preview

Service Workerと`fetch()`を使用するため、`site/`をローカルHTTPサーバーで公開します。

```powershell
cd site
python -m http.server 8000
```

ブラウザで `http://localhost:8000/` を開きます。

## Data pipeline

データ生成スクリプトはWindows 11向けです。PowerShellスクリプトはすべてUTF-8 BOM付きで保存します。

```powershell
pwsh -File .\pipeline\scripts\08-build-all.ps1
```

詳細は [docs/data-pipeline.md](docs/data-pipeline.md) を参照してください。

## Validation

Install Node.js dependencies:

```powershell
npm install
```

Run the standard checks:

```powershell
npm run check
```

Run Playwright UI regression tests:

```powershell
npm run test:e2e
```

Development tool details are documented in [docs/development.md](docs/development.md).

Legacy direct validation command:

```powershell
node .\tools\validate-site.mjs
```

## Rights and license

アプリケーションコードとプロジェクト用ツールには MIT License を適用します。

FINAL FANTASY XIV の画像、名称、アイテム/レシピデータ、商標、その他ゲーム由来素材の権利は SQUARE ENIX に帰属します。本プロジェクトは非公式であり、SQUARE ENIX の承認、提携、後援を示すものではありません。

SQUARE ENIX から修正、削除、公開停止、提供停止などの指示があった場合は迅速に従います。必要に応じて、アプリの提供停止や対象素材/データの削除を実施します。

詳細は [NOTICE.md](NOTICE.md) を参照してください。
