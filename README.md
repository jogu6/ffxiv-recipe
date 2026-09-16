# FinalFantasy XIV® Crafting Assistant XIVca(シヴカ)

FF14のレシピ、必要素材、中間素材、装備、採集・店舗情報の確認と、製作マクロの生成を行う静的Webアプリです。

- [公開サイト](https://jogu6.github.io/ffxiv-recipe/)
- GitHub Pagesで配信
- PWA対応、日本語表示専用

## 主な機能

- アイテム名からのレシピ検索と、複数の製作方法の選択
- ジョブ、装備レベル、アイテムレベル、部位による装備検索
- レシピツリーと必要素材リストの表示
- お気に入りリストの複数管理、製作数の設定、複数リストの素材合算
- 中間素材の製作回数、余り、使用先、依存関係・製作ジョブを考慮した製作順の表示
- 中間素材の店舗購入指定と、それにより準備不要になる素材の表示
- 中間素材のミニレシピツリー、交換・精選素材と交換貨幣の補足表示
- 採集場所、ET時間帯、LTカウントダウン、店舗・販売価格・販売場所の表示
- シェアコードによるお気に入りの共有、ファイルへの保存・取り込み
- 表示内容のテキスト・画像共有と、シェアコード広場の表示
- 検索条件、選択画面、素材のチェック状態、パネル表示の復元
- 10段階のフォントサイズ設定と、画面幅に応じたパネル表示
- 製作ステータス、食事・薬品、中間素材HQを指定するマクロ生成（β）
- 診断情報と任意の画像を添付できる不具合・お問い合わせ送信

## データと保存

アイテム・レシピ情報は日本語版Lodestoneをもとに生成します。アプリは公開済みのデータを読み込み、検索・素材計算・マクロ生成をブラウザー内で実行します。

お気に入りや表示設定はブラウザーに保存します。アイテムデータ、検証済み画像パック、起動時の整形済みデータは版を識別して再利用します。マクロの探索データは必要に応じて端末内の一時保存へ退避します。保存データはブラウザーや端末ごとに独立しているため、お気に入りの移動にはシェアコードまたはファイル保存・取り込みを使います。

アプリの更新時はService Workerの更新を確認し、適用後に再読み込みします。更新内容の確認が必要な場合は、確認画面を閉じてから利用を再開します。

## 開発と確認

Node.js 24以降を使用します。ブラウザーでの確認にはPython、マクロエンジンのビルドにはRustとWASMのツールチェーン、データ生成GUIにはWindows 11とTauriのビルド環境が必要です。

```powershell
npm install
npm run dev
```

プレビューサーバーは4173番ポートを使用します。マクロ機能を含む確認では、事前にマクロのビルドと公開配置を行います。

変更対象に対応するチェックを実行します。

```powershell
npm run check:js
npm run check:site
npm run check:app
npm run check:calculation
npm run check:pipeline
npm run check:crafting-mechanics
npm run check:macro-launcher
```

`npm run check`は上記チェックをまとめて実行します。ブラウザー検証は対象を指定します。

```powershell
npm run test:e2e -- --grep "<test name>"
npm run test:e2e:app -- --grep "<test name>"
npm run test:pipeline:gui
```

開発環境、マクロのビルド、検証、公開処理は[開発ガイド](docs/development.md)を参照してください。

## データ生成

Node.jsとTauriの生成ツールで、Lodestone完全監査、候補生成、画像整備、公開用データへの反映と検証を実行します。GUIには個別実行と一括実行があり、取得間隔、WebP品質、画像サイズを設定できます。

```powershell
npm run pipeline:gui
npm run pipeline:gui:check
npm run pipeline:gui:build:exe
npm run pipeline:gui:build:timings
npm run pipeline:gui:build
```

`pipeline:gui:check`は増分チェック、`pipeline:gui:build:exe`はインストーラーなしの実行ファイル生成、`pipeline:gui:build:timings`は計測付き生成、`pipeline:gui:build`はNSISインストーラーを含むビルドです。

詳細は[データ生成](docs/data-pipeline.md)を参照してください。

## Lodestone更新監視と自動公開

定期実行では、製作手帳の全一覧ページを、最後に公開反映が成功した完全監査の保存内容と比較します。変更がなければ通知せず終了し、未反映の変更があれば新しい完全監査、データ・画像パック生成、キャッシュ識別子更新、検証、コミット、push、GitHub Pagesのデプロイ確認へ進みます。

レシピ一覧に現れない詳細ページだけの変更は、定期比較の検知対象外です。自動公開は設定したリモートと同期した`main`から始まり、生成データと必要なキャッシュ定数だけをコミットします。無関係な編集中・ステージ済みの変更は維持されます。

詳細は[更新監視と復旧](docs/lodestone-update-monitor.md)を参照してください。

## 関連ドキュメント

- [Service Workerとキャッシュ](docs/service-worker-notes.txt)
- [マクロ生成機能](macro-app/README.md)
- [固定マスターデータ](pipeline/input/web-app/README.md)
- [ジョブアイコンの制作仕様](tools/job-icons/README.md)
- [お問い合わせ送信Worker](workers/bug-report/README.md)

## 権利とライセンス

独自のアプリケーションコードとプロジェクト用ツールには [MIT ライセンス](LICENSE)を適用します。[日本語の説明と参考訳](site/docs/license-notice.md)も掲載しています。

FINAL FANTASY XIV の画像、名称、アイテム・レシピデータ、商標などのゲーム由来素材の権利は、SQUARE ENIX または各権利者に帰属します。ゲーム由来素材や第三者のライブラリには、それぞれの権利者が定める条件が適用されます。本プロジェクトは非公式であり、SQUARE ENIX の承認、提携、後援を示すものではありません。

SQUARE ENIX やホスティング提供者からの要請・措置に従い、必要な修正、削除、公開・提供の停止を行います。

詳細は [NOTICE.md](NOTICE.md) および [site/docs/license-notice.md](site/docs/license-notice.md) を参照してください。
