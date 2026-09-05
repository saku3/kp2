# kp2 — Markdown 手順書 + ブラウザターミナル

ブラウザの左ペインに Markdown 手順書、右ペインに xterm.js のターミナルを表示し、
手順書の `bash` / `sh` / `shell` コードブロックの **Run** ボタンでコマンドをローカル shell に流し込むツールです。
「ローカルで動く Instruqt / Killercoda」の最小構成 (MVP) です。

```
Browser
  Markdown ──Run──▶ xterm.js ──WebSocket (/ws, proxied by Vite)──▶ ttyd ──▶ PTY ──▶ $SHELL
```

## 必要なもの

- Node.js 20 以上
- [ttyd](https://github.com/tsl0922/ttyd) 1.7 以上 (macOS: `brew install ttyd`)

## 起動

```bash
npm install
npm run dev
```

`npm run dev` は次の 2 つを同時に起動します。

| プロセス | バインド先 | 役割 |
| --- | --- | --- |
| ttyd (`scripts/ttyd.sh`) | `127.0.0.1:7681` | PTY と shell (`$SHELL` → `/bin/zsh` → `/bin/bash` の順で選択) |
| Vite dev server | `127.0.0.1:5173` | React UI の配信。`/ws` と `/token` を ttyd へプロキシ |

ブラウザで <http://127.0.0.1:5173/> を開いてください。

本番ビルドを試す場合は `npm run build && npm start` です (Vite preview + ttyd、同じポート構成)。preview では手順書のライブ更新は効きません。

## 手順書

デフォルトではリポジトリ内の `docs/*.md` を読み込みます。デフォルトは `docs/getting-started.md` です。
Markdown は実行時にサーバーが読むので、編集すると即座に左ペインだけが更新され、ターミナルはそのまま維持されます。

### 別のディレクトリの手順書を開く

リポジトリ外の任意のディレクトリを 3 通りの方法で指定できます。

1. **パスを入力**: ヘッダーのフォルダ名をクリックすると開くパネルに `~/notes/k8s` のようなパスを入れて **Open**。
   サブディレクトリの `.md` も再帰的に一覧に出ます。最近開いたフォルダは同じパネルに並び、次回起動時も最後に開いた場所を復元します。
2. **Choose folder…** (Chrome / Edge のみ): 同じパネルから OS のフォルダ選択ダイアログで選びます。この場合はブラウザが直接ファイルを読み、
   サーバーは関与しません。変更は 2 秒ごとのポーリングで検知します。リロード後は「Re-open」を押すと再度読めるようになります (ブラウザの権限仕様)。
3. **起動時の指定**: `DOCS_DIR=~/notes npm run dev` でデフォルトのディレクトリを変えられます。`?dir=<path>` を URL に付けても同じです。

### お気に入り (Pinned)

よく使うフォルダや手順書はピン留めできます。ヘッダーの手順書名の横にある ☆ で今の手順書を、フォルダパネル内の ☆ でフォルダや最近の項目をピン留めし、パネルの **Pinned** から 1 クリックで開けます。

保存先はブラウザではなくファイルです (ブラウザを変えても残り、手で編集したり dotfiles に入れたりできます)。

| 優先順 | 場所 |
| --- | --- |
| 1 | `$KP2_CONFIG_DIR/favorites.json` |
| 2 | `$XDG_CONFIG_HOME/kp2/favorites.json` |
| 3 | `~/.config/kp2/favorites.json` |

```json
{
  "favorites": [
    { "dir": "~/notes/k8s" },
    { "dir": "~/notes/k8s", "doc": "setup.md", "label": "K8s setup" }
  ]
}
```

`dir` は `~` 始まりでも構いません。`label` は省略可能で、表示名になります。ファイルを手で編集すると開いているブラウザにも即時反映されます。
Choose folder… で選んだフォルダはパスをブラウザから取得できないためピン留めできません。パス入力で開き直してください。

`?doc=<ファイル名>` で表示する手順書を選べます (ヘッダーのファイル名をクリックしても切り替えられます)。

サーバーが返すのは指定ディレクトリ配下の `.md` ファイルだけで、`..` などで外に出ることはできません。

すべてのコードブロックに **Copy** があり、内容をクリップボードにコピーします。
言語が `bash` / `sh` / `shell` のときはさらに次の 2 つが表示されます。

- **Run**: 表示されている内容をそのままターミナルへ送り、最後に Enter を送ります。複数行はそのまま順に実行されます。
- **Insert**: 内容を入力するだけで Enter は送りません (bracketed paste で送るので、複数行でも 1 つの入力として編集できます)。

## ターミナル操作

- 通常のキー入力、Ctrl-C などの制御キーはそのまま shell に届きます
- コピー: 選択して Cmd+C (macOS) / Ctrl+Shift+C。ペースト: Cmd+V / Ctrl+Shift+V
- ウィンドウ/ペインのサイズ変更に追従して PTY を resize します
- 接続が切れた場合はターミナル上部の **Reconnect** で再接続できます

## セキュリティ

このツールはローカルマシン上で任意のコマンドを実行できます。

- ttyd も Vite も **127.0.0.1 のみ** にバインドします。外部ネットワークには公開しないでください
- Run ボタンが送る内容は、画面に表示されているコードブロックの内容そのものです。隠しコマンドや変換はありません
- Markdown を開いただけでは何も実行されません。実行は必ずボタン操作かキー入力によります
- 認証はありません (MVP)。信頼できるローカル環境でのみ使ってください

## 構成

```
docs/getting-started.md   手順書 (Markdown、デフォルトのディレクトリ)
scripts/ttyd.sh           ttyd 起動スクリプト (localhost bind, shell 選択)
vite.config.ts            dev/preview server の localhost bind と ttyd へのプロキシ
vite-docs-plugin.ts       任意ディレクトリの .md を配信し、変更を HMR で通知するミドルウェア
vite-favorites-plugin.ts  favorites.json の読み書き API と変更通知
src/ttyd.ts               ttyd WebSocket プロトコルの最小クライアント
src/TerminalPane.tsx      xterm.js + fit addon + resize/copy/paste
src/Guide.tsx             Markdown レンダリングと Run / Insert ボタン
src/docs.ts               手順書ストア (サーバー経由 / File System Access API の 2 系統)、手順書の選択、お気に入り
src/DocsPicker.tsx        ヘッダーのフォルダ / 手順書セレクタとフォルダ選択パネル
src/App.tsx               2 ペインレイアウト
```

## ttyd を選んだ理由

ttyd の WebSocket プロトコルは非常に単純で (先頭 1 バイトがコマンド種別、`'0'`=入力、`'1'`=resize)、
ttyd 同梱の Web UI を使わずとも xterm.js から直接話せます。
そのため PTY 管理・resize・シグナル処理を自前で持つ必要がなく、backend は ttyd のプロセス 1 つだけです。
