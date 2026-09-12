# 不具合・その他お問い合わせの送信Worker

アプリから受け取った本文と診断情報を、Discordの `bug-report.txt` 添付ファイルとして送信します。任意のスクリーンショットは画像ファイルとして同じ投稿に添付します。Webhookは `DISCORD_WEBHOOK_URL` シークレットから参照し、コード・応答・添付には出力しません。

## 配置

このフォルダーに `worker.mjs` と `wrangler.jsonc` を用意済みです。Cloudflareで同名Workerを作成し、`DISCORD_WEBHOOK_URL` をシークレットとして登録した後、リポジトリのルートで実行します。

```powershell
npx wrangler login
npx wrangler deploy --config workers/bug-report/wrangler.jsonc
```

ログインで対象のCloudflareアカウントを選択してください。配置すると同名WorkerのHello Worldが置き換わり、連投制限のバインディングも登録されます。Webhookシークレットは設定ファイルへ書きません。

`REPORT_LIMITER` は同じ接続元から60秒あたり3回を目安に制限します。Cloudflare拠点ごとの制限であり、厳密な全世界共通の回数制限ではありません。共有回線では複数ユーザーが同じ制限を共有します。設定が欠けた場合は送信を受け付けません。

`ALLOWED_ORIGINS` はカンマ区切りの許可元です。初期設定は公開GitHub PagesとローカルPCの4173です。LANから試す場合は、その実際のオリジンを追加して配置してください。Originチェックだけで送信者を認証できるわけではありません。

## 確認

IPアドレスを閲覧・保存しない運用のため、Workersのログ保存、Logpush、Tail Workersへの転送を設定ファイルで無効化しています。リアルタイムログや `wrangler tail` は使用しません。調査にはIPを含まない報告本文とHTTP応答を使用します。Cloudflareによる通信処理と連投制限は継続します。この設定変更は過去のログを削除するものではありません。

設定画面またはマクロパネルの「不具合・お問い合わせ」ボタンから入力します。確認画面には本文と任意の添付画像が表示され、診断情報は表示されません。最終送信でDiscordへ実際の投稿が行われます。空白だけと1,000文字超過はブラウザーとWorkerの双方で拒否します。確定前のキャンセルでは送信しません。送信開始後は、通信をキャンセルしても投稿済みの可能性があるため自動再送しません。

診断は問い合わせ画面を開いた時点で取得します。利用環境に加え、使用中の左・中央・右パネルの検索条件、表示内容、製作数や素材のチェック状態などを含みます。マクロパネルを開いている場合だけ、レシピ、ステータス、中間素材、選択した食事・薬品、表示対象の前回結果、生成入力・直近計測を含みます。Cookie・保存領域全体・閲覧URL・IPアドレスは添付しません。利用者が本文に記入した連絡先はそのまま送信します。Cloudflareは通信を処理するために接続元IPを受け取り、Worker内では連投制限だけに使います。

画像はPNG・JPEG・WebPを4枚まで選択・貼り付けできます。元画像は1枚32MiBまでとし、ブラウザー内でWebPへの変換を試み、必要に応じて品質・解像度を調整します。元画像の方が小さい場合は元の形式を維持し、WebP出力に対応していないブラウザーではPNGまたはJPEGを使用します。送信画像の合計は8MiBまでです。Workerでも枚数、容量、形式と先頭の識別バイトを検証し、元ファイル名を汎用名へ置き換えます。

画像なしの送信は従来のJSON、画像ありの送信は `multipart/form-data` を使用します。旧Workerは画像添付を受け付けないため、画像添付に対応したアプリの公開前にWorkerを更新してください。

自動テストではブラウザーの画像変換と送信モック、WorkerからDiscordへの転送モックを検証します。Discordへの実際の到着確認は別途必要です。

公式資料: [秘密情報](https://developers.cloudflare.com/workers/configuration/secrets/)、[連投制限](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)、[Discord Webhook](https://docs.discord.com/developers/resources/webhook)。
