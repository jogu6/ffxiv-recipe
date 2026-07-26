# XIVAPI CSV 調査環境

`xivapi/ffxiv-datamining` の日本語CSVを対象に、レシピが存在するアイテムとその製作素材について、どのCSVを追加・結合すれば何が分かるかを調査するための環境です。

Webアプリへの実装やデータ追加は行いません。生CSV、再生成可能な中間データ、機械可読の解析結果、人が読む検証レポートはすべてローカル専用です。調査結果をGitへコミットまたは公開してはいけません。

作業を再開するときは、最初に `reports/resume.md` を読んでください。

## コマンド

```powershell
npm run xivapi:download
npm run xivapi:analyze
npm run xivapi:validate
npm run xivapi:status
```

取得処理はファイル単位で状態を保存し、中断後に同じコマンドを実行すると未完了分から再開します。通常の進捗表示は同じ行を更新し、警告と段階変更だけを新しい行へ出力します。詳細は `logs/`、現在状態は `state/status.json` に保存されます。

## 管理対象

| パス       | 内容                                               | Git管理  |
| ---------- | -------------------------------------------------- | -------- |
| `source/`  | 取得した日本語CSV、EXDSchema、取得マニフェスト     | 対象外   |
| `cache/`   | 対象Item一覧、全CSV棚卸し、CSV別の再開用中間データ | 対象外   |
| `logs/`    | 詳細な実行ログ                                     | 対象外   |
| `state/`   | 再開用状態と現在の進捗                             | 対象外   |
| `output/`  | コンパクトな機械可読最終解析結果                   | 対象外   |
| `reports/` | 人が確認する調査結果                               | 対象外   |

主要な成果物は `reports/capability-map.md` です。「このCSVを追加すると、対象アイテムの何が分かるか」を知りたい情報ごとの文章で説明します。`reports/obtainable-data.md` は、対象Itemを直接参照する全CSVについて、CSV 1件ごとに分かる内容を示します。技術的な結合経路は `reports/csv-dependencies.md` に分離しています。

## 判定の扱い

CSVの参照型は、CSV生成器が使用する `xivdev/EXDSchema` を同時取得して判定します。定義にない列を列名と値だけから推定した場合は、確定情報とは区別します。レポートでは次の三段階を使用します。

- `verified`: CSV名・列名・実データの参照が一致したもの
- `candidate`: 列名と値から参照候補と判断したもの
- `unresolved`: CSVだけでは意味または結合先を確定できないもの

解析に使用した `ffxiv-datamining` のコミットIDは、すべての最終結果へ記録します。
