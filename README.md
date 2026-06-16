# FFXIV Recipe Material Tree

FFXIVのレシピと必要素材をツリー表示する静的Webアプリです。

- 公開サイト: https://jogu6.github.io/ff14-recipe/
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

```powershell
node .\tools\validate-site.mjs
```

## Rights and license

アプリケーションコードはMIT Licenseです。ゲーム画像、ゲーム由来データ、商標などにはMIT Licenseを適用しません。詳細は [NOTICE.md](NOTICE.md) を参照してください。
