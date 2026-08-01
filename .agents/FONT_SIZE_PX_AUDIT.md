# フォントLevel固定px監査（ローカル専用）

対象: `site/styles.css`、`site/index.html`、`site/app.js`、関連テスト

## 抽出結果

- CSS: 875個のpxトークン（pxを含む733宣言行）
- CSS font-size: 132宣言（px 130、inherit 2）
- 実行時JS: px設定17行
- 関連テスト: pxを含む32行

## 全件分類規則

|分類|対象|処理|
|---|---|---|
|倍率連動|全px指定font-size、line-heightが文字寸法を継承する要素|`calc(基準px * --font-size-scale)`。unitless line-heightはそのまま文字寸法へ追従|
|倍率連動・共通寸法|アプリタイトル画像、アイテム画像、画像チェック、素材補足画像、Discord SVG、各チェックUI|同種要素ごとの共通CSS変数を使用|
|表示寸法追従|折畳み高さ、選択肢幅、素材ツリー高、ショップ幅、ドロップダウン位置と幅|DOM実寸または表示領域から算出。Level別決め打ちは行わない|
|固定外形|パネル・ダイアログの上限幅、スクロール領域上限、操作領域の最低寸法|現行値を維持。内容が収まらない固定高だけ自動高へ変更|
|固定余白|margin、padding、gap、インデント、位置調整|倍率連動させない|
|固定装飾|border、border-radius、box-shadow、outline、text-shadow、stroke、scrollbar|倍率連動させない|
|固定境界|media query、viewport差引、600px境界|フォントLevelに関係なく固定|
|テスト基準|既存px期待値、viewport寸法|Level 2の不変基準、または固定検証幅として維持|

## 寸法プロパティの例外一覧

倍率連動する意味表示: `.app-title-icon`、`.favorite-list-material-checkbox`、`.favorite-anyone-checkbox`、`.material-supplement-icon`、`.node-icon`、`.list-icon`、`.checkable-item-icon`、`.item-image-check`、`.recipe-method-check`、`.discord-icon`、`.shop-purchase-option input`。

内容に追従して固定高を解除する領域: `.materials-list li`、`.materials-list li.intermediate-tree-node`、`.node-children`、モバイルのヘッダー行。折畳み中は0、開閉アニメーション中はJSが計測した実高を使う。

上記以外のwidth、height、min/max寸法は、レイアウト幅、スクロール上限、操作領域、アクセシビリティ用クリップ、または装飾寸法として固定維持する。文字の収まりは自動高、min寸法、折返しで確保する。

## JS 17行

- 892–903: 折畳み開始・終了の実測高
- 1343–1349: カスタム選択肢の実測幅、表示領域内の位置・最大高
- 1975: お気に入り一覧の表示領域追従高
- 4210: 実測文字幅から算出するレシピ方式セレクター幅
- 5135: 素材ツリーダイアログの実測高
- 5530–5545: ショップ列と表示領域から算出するダイアログ幅
- 5902–5905: 設定ドロップダウンの実測位置・幅・最大高

すべて「表示寸法追従」に分類し、Level別固定値は持たない。
