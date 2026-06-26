# FF14レシピ素材ツリー

FF14のレシピ、必要素材、制作する中間素材、交換/精選素材を確認するための静的Webアプリです。

- 公開サイト: https://jogu6.github.io/ffxiv-recipe/
- GitHub Pagesで配信
- PWA対応
- 日本語表示専用
- データ生成処理はWindows 11上のPowerShellで実行

## 主な機能

- アイテム名からレシピを検索
- レシピツリー表示
- 必要素材リスト表示
- お気に入りリスト複数管理
- お気に入りリスト全体の素材リスト表示
- 中間素材の製作回数と余り表示
- 中間素材からミニレシピツリーを表示
- 交換/精選素材と交換貨幣の補足表示
- シェアコードによるお気に入りリストの共有

## Repository structure

```text
site/       GitHub Pagesへ公開するWebアプリ
pipeline/   CSV入力、生成途中のJSON、生成ツール、GUI、ログ
design/     アプリアイコンの原本と旧デザイン素材
docs/       開発・運用ドキュメント
tools/      環境構築、検証、リポジトリ操作用ツール
.github/    GitHub Actions
```

## Local preview

Service Workerと`fetch()`を使用するため、`site/`をローカルHTTPサーバーで公開します。

```powershell
npm run dev
```

ブラウザで `http://127.0.0.1:4173/` を開きます。

スマートフォンなどLAN内の別端末から確認する方法は [.vscode/local-dev-notes.md](.vscode/local-dev-notes.md) を参照してください。

## Data pipeline

データ生成はこのWebアプリ専用の Node.js/Tauri ツールで実行します。Tauri exe はリポジトリ全体のバージョンとは別に、アイテム情報作成ツール単体として `v1.0` を扱います。

```powershell
npm run pipeline:gui
npm run pipeline:gui:build
```

詳細は [docs/data-pipeline.md](docs/data-pipeline.md) を参照してください。

## Validation

Node.js依存関係をインストールします。

```powershell
npm install
```

標準チェックを実行します。

```powershell
npm run check
```

Playwright UI回帰テストを実行します。

```powershell
npm run test:e2e
```

開発ツールの詳細は [docs/development.md](docs/development.md) を参照してください。

## Rights and license

アプリケーションコードとプロジェクト用ツールには MIT License を適用します。

FINAL FANTASY XIV の画像、名称、アイテム/レシピデータ、商標、その他ゲーム由来素材の権利は SQUARE ENIX に帰属します。本プロジェクトは非公式であり、SQUARE ENIX の承認、提携、後援を示すものではありません。

SQUARE ENIX から修正、削除、公開停止、提供停止などの指示があった場合は迅速に従います。また、GitHub等のホスティング提供者により、事前通知の有無にかかわらず公開停止、削除、制限、アクセス不能などの措置が行われた場合も、その措置に従い、必要な修正・削除・運用変更を行います。

詳細は [NOTICE.md](NOTICE.md) および [site/docs/license-notice.md](site/docs/license-notice.md) を参照してください。
