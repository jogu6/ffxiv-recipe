# FF14レシピ素材ツリー

FF14のレシピ、必要素材、中間素材、装備、採集・店情報を確認するための静的Webアプリです。

- 公開サイト: https://jogu6.github.io/ffxiv-recipe/
- GitHub Pagesで配信
- PWA対応
- 日本語表示専用
- データ生成処理はWindows 11上のNode.js 24以降/Tauriツールで実行

## 主な機能

- アイテム名からレシピを検索
- ジョブ、装備レベル、アイテムレベル、部位による装備検索
- レシピツリー表示
- 必要素材リスト表示
- お気に入りリスト複数管理
- 複数のお気に入りリストを合算した素材リスト表示
- 中間素材の製作回数と余り表示
- 中間素材の使用先と、依存関係・製作ジョブを考慮した製作順表示
- 店舗購入する中間素材と、それにより準備不要になる素材の表示
- 中間素材からミニレシピツリーを表示
- 交換/精選素材と交換貨幣の補足表示
- 採集場所、ET時間帯、LTカウントダウン表示
- 店舗、販売価格、販売場所の表示
- シェアコードによるお気に入りリストの共有
- 検索条件、選択画面、素材リスト作業状態の復帰

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
py -m http.server 4173 --bind 0.0.0.0 --directory site
```

ブラウザで `http://127.0.0.1:4173/` を開きます。`npm run dev`でも同じサーバーを起動できます。

スマートフォンなどLAN内の別端末から確認する場合は、同じネットワーク内で開発PCのIPアドレスと `4173` 番ポートを開きます。

## Data pipeline

データ生成はこのWebアプリ専用の Node.js/Tauri ツールで実行します。Tauri exe はリポジトリ全体のバージョンとは別に、アイテム情報作成ツール単体として `v1.0` を扱います。機能名、説明、ボタン名、確認文、引数、推奨実行順は`pipeline/tool/pipeline-ui-definition.mjs`を正本とし、exeは起動時に読み込んでUIと実行監視へ反映します。

```powershell
npm run pipeline:gui
npm run pipeline:gui:check
npm run pipeline:gui:build:exe
npm run pipeline:gui:build:timings
npm run pipeline:gui:build
```

`pipeline:gui:check`はRust/Tauriの増分チェック、`pipeline:gui:build:exe`はインストーラーを作らない高速なexe生成、`pipeline:gui:build`はNSISインストーラーを含む配布ビルドです。`pipeline:gui:build:timings`はexeを生成し、`src-tauri/target/cargo-timings/`へCargoの計測結果を出力します。

共通ラッパーはツールチェーン内の`rust-lld`を検出します。開発・検査ではCargoのincrementalを使い、exe・配布ビルドでは依存クレートを`sccache`へ保存します。キャッシュ不能な最終アプリだけは専用プロファイルでincrementalを維持します。ビルド後にはsccacheの統計を表示し、キャッシュ障害時は通常コンパイルへ退避します。

詳細は [docs/data-pipeline.md](docs/data-pipeline.md) を参照してください。

## Validation

Node.js 24以降で依存関係をインストールします。

```powershell
npm install
```

標準チェックを実行します。JavaScript構文チェック、サイトデータ検証、アプリと計算ロジックのNode.jsテスト、パイプラインツールのNode.jsテストを並列に実行します。

```powershell
npm run check
```

個別に確認したい場合は、以下の npm scripts を使います。

```powershell
npm run check:js
npm run check:site
npm run check:app
npm run check:calculation
npm run check:pipeline
npm run pipeline:gui:check
```

PlaywrightによるブラウザUI回帰テストを実行します。

```powershell
npm run test:e2e
npm run test:e2e:app
npm run test:pipeline:gui
```

`test:e2e:app`は公開アプリだけを対象にします。変更中はさらに`npm run test:e2e:app -- --grep "<test name>"`で対象を絞り、最終確認では`test:e2e`を実行します。

安定実行設定は`playwright.config.js`へ集約しています。公開サイトE2Eはファイル単位で並列化し、ローカルではCPUに応じて2～4ワーカー、CIでは2ワーカーを使用します。独立したTauriモックを使うpipeline GUI E2Eはファイル内も並列化します。互換性のあるテスト用サーバーが4173番ポートで動作済みの場合は再利用します。ワーカー数と設定ファイルはコマンドラインから上書きできません。

ユーザーに見える機能追加・仕様変更・バグ修正には、その挙動を表す固有名のE2Eテストを追加してください。

開発ツールの詳細は [docs/development.md](docs/development.md) を参照してください。

## Rights and license

アプリケーションコードとプロジェクト用ツールには MIT License を適用します。

FINAL FANTASY XIV の画像、名称、アイテム/レシピデータ、商標、その他ゲーム由来素材の権利は SQUARE ENIX に帰属します。本プロジェクトは非公式であり、SQUARE ENIX の承認、提携、後援を示すものではありません。

SQUARE ENIX から修正、削除、公開停止、提供停止などの指示があった場合は迅速に従います。また、GitHub等のホスティング提供者により、事前通知の有無にかかわらず公開停止、削除、制限、アクセス不能などの措置が行われた場合も、その措置に従い、必要な修正・削除・運用変更を行います。

詳細は [NOTICE.md](NOTICE.md) および [site/docs/license-notice.md](site/docs/license-notice.md) を参照してください。

## XIVAPI更新監視

XIVAPI由来のCSVを毎日確認し、変更時だけDiscordへ通知できます。

詳細なセットアップ、タスク設定、ログ、テスト通知については [XIVAPI update monitor](docs/xivapi-update-monitor.md) を参照してください。

1. `pipeline/config/xivapi-monitor.example.json` を `pipeline/config/xivapi-monitor.local.json` としてコピーします。
2. `discordWebhookUrl` に通知先のDiscord Webhook URLを設定します。ローカル設定はGitの追跡対象外です。
3. Gitの追跡対象外であるローカルのタスク定義をタスクスケジューラへインポートし、実行ユーザーのパスワードを設定します。
4. タスクを一度手動実行して基準状態を保存します。初回実行では通知しません。

Webhookへのテスト通知は `node pipeline/tool/xivapi-update-monitor.mjs --test-notification` で送信できます。この操作では監視の基準状態を変更しません。

タスクは `wscript.exe` の非表示実行からNode.jsを起動するため、ターミナルウィンドウを表示しません。状態、取得キャッシュ、ログはそれぞれ `pipeline/state/`、`pipeline/cache/`、`pipeline/logs/` に保存され、いずれもGitの追跡対象外です。
