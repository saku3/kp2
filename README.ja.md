# kp2 — Markdown 手順書 + ブラウザターミナル

[English](README.md) | 日本語

ブラウザの左ペインに Markdown 手順書、右ペインに xterm.js のターミナルを表示し、
手順書の `bash` / `sh` / `shell` コードブロックの **Run** ボタンでコマンドをローカル shell に流し込むツールです。
「ローカルで動く Instruqt / Killercoda」の最小構成 (MVP) です。

```
Browser
  Markdown ──Run──▶ xterm.js ──WebSocket /ws──▶ kp2 (Rust) ──▶ PTY ──▶ $SHELL
                                                 │
                                                 └─ code-server (任意) ──▶ ブラウザ版 VS Code
```

backend は Rust 製の単一バイナリ `kp2` (`server/`) です。ターミナルの PTY を持ち、手順書とお気に入りの API を提供し、code-server が入っていれば起動し、ビルド済みの UI を同梱します。

## 必要なもの

ソースからビルドする場合に必要です (ビルド済みバイナリを使うなら不要)。

- Node.js 20 以上 (フロントエンドのビルドと開発用)
- Rust (stable)
- 任意: [code-server](https://github.com/coder/code-server) (macOS: `brew install code-server`)。入っているとブラウザ版 VS Code のペインが出ます

## 起動

### ビルド済みバイナリ

[リリース](https://github.com/saku3/kp2/releases)ごとに、macOS (Apple silicon、Intel) と Linux (x86_64、arm64。静的リンクなのでディストリビューションを問いません) 向けの `kp2` バイナリを 1 つずつ置いています。
自分のプラットフォームのアーカイブを取得して展開し、`kp2` を `PATH` の通った場所に置いてください。

```bash
tar xzf kp2-v0.1.0-aarch64-apple-darwin.tar.gz
```

```bash
./kp2 --version
```

### 開発

```bash
npm install
npm run dev
```

`npm run dev` は次の 2 つを同時に起動します。

| プロセス | バインド先 | 役割 |
| --- | --- | --- |
| kp2 (`cargo run`) | `127.0.0.1:7681` | PTY と shell、手順書とお気に入りの API、code-server の起動 |
| Vite dev server | `127.0.0.1:5173` | React UI の配信。`/ws` `/token` `/api` を kp2 へプロキシ |

ブラウザで <http://127.0.0.1:5173/> を開いてください。

### 単一バイナリで動かす

```bash
npm run build   # tsc + vite build + cargo build --release
npm start       # = server/target/release/kp2
```

`kp2` はビルド済みの UI を同梱しているので、Node も Vite も不要で <http://127.0.0.1:5173/> にそのまま出ます。

```
kp2 [--port 5173] [--docs docs] [--workspace .] [--no-editor] [--editor-port 7682]
```

- `--docs`: 既定の手順書フォルダ (環境変数 `DOCS_DIR` でも指定可)
- `--workspace`: ターミナルの開始ディレクトリで、code-server が開くフォルダ (環境変数 `KP2_WORKSPACE` でも指定可)
- `--no-editor`: code-server が入っていても起動しない
- `--allowed-origin`: ターミナルへの接続を追加で許可するオリジン (例: `https://handson.example.com`)。リバースプロキシの後ろで使うときに指定する。ブラウザが送る形で書き、`:443` のような既定ポートは付けない。複数指定するときはフラグを繰り返すかカンマで区切る (環境変数 `KP2_ALLOWED_ORIGINS` でも指定可)
- `--editor-url`: エディタペインが code-server を読み込む URL。リバースプロキシが `/code/` を code-server へ転送する構成なら `/code/` を指定する。既定は `http://127.0.0.1:<editor-port>/` (環境変数 `KP2_EDITOR_URL` でも指定可)

shell は `$SHELL` → `/bin/zsh` → `/bin/bash` の順で選び、ログインシェルとして起動します。

## 手順書

デフォルトではリポジトリ内の `docs/*.md` を読み込みます。デフォルトは `docs/getting-started.md` です。
Markdown は実行時にサーバーが読み、変更は server-sent events で通知されるので、編集すると即座に左ペインだけが更新され、ターミナルはそのまま維持されます。

### 別のディレクトリの手順書を開く

リポジトリ外の任意のディレクトリを 3 通りの方法で指定できます。

1. **パスを入力**: ヘッダーのフォルダ名をクリックすると開くパネルに `~/notes/k8s` のようなパスを入れて **Open**。
   サブディレクトリの `.md` も再帰的に一覧に出ます。最近開いたフォルダは同じパネルに並び、次回起動時も最後に開いた場所を復元します。
2. **Choose folder…** (Chrome / Edge のみ): 同じパネルから OS のフォルダ選択ダイアログで選びます。この場合はブラウザが直接ファイルを読み、
   サーバーは関与しません。変更は 2 秒ごとのポーリングで検知します。リロード後は「Re-open」を押すと再度読めるようになります (ブラウザの権限仕様)。
3. **起動時の指定**: `kp2 --docs ~/notes` (または `DOCS_DIR=~/notes npm run dev`) でデフォルトのディレクトリを変えられます。`?dir=<path>` を URL に付けても同じです。

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

### 階層のあるフォルダ

サブディレクトリの `.md` も再帰的に読み込み、`k8s/setup.md` のような相対パスが手順書名になります。
ヘッダーのドロップダウンではサブディレクトリごとにまとめて表示されます。

Markdown 内の相対リンク (`[次へ](./ops/backup.md)` や `[戻る](../intro.md)`) は、同じフォルダ内の手順書を指していればクリックでその手順書に切り替わります。
フォルダの外に出るリンクや存在しないファイルへのリンクは取り消し線付きになり、クリックしても何も起きません。`http(s)://` のリンクは新しいタブで開きます。

画像 (`![構成図](./img/arch.png)`) の相対パスも手順書の場所から解決され、同じフォルダ内の画像 (png / jpg / gif / svg / webp / avif) が表示されます。

サーバーが返すのは指定ディレクトリ配下の `.md` ファイルだけで、`..` などで外に出ることはできません。

すべてのコードブロックに **Copy** があり、内容をクリップボードにコピーします。
言語が `bash` / `sh` / `shell` のときはさらに次の 2 つが表示されます。

- **Run**: 表示されている内容をそのままターミナルへ送り、最後に Enter を送ります。複数行はそのまま順に実行されます。コード部分の**ダブルクリック**でも同じです。
- **Insert**: 内容を入力するだけで Enter は送りません (bracketed paste で送るので、複数行でも 1 つの入力として編集できます)。

## エディタ (code-server)

code-server が入っていると kp2 が子プロセスとして起動し、ヘッダー右端に **Editor** ボタンが出ます。押すと右ペインが上下に分かれて上にブラウザ版 VS Code、下にターミナルが出ます (境界はドラッグで動かせます)。もう一度押すと隠れます。既定は隠れた状態で、選択はブラウザに記憶されます。手順書の `vscode:` リンクを押すと自動で表示されます。ヘッダーの手順書名の横にある鉛筆アイコンで、いま表示している手順書そのものを VS Code で開けます。保存すると左ペインが即時更新されます。
VS Code が開くフォルダ (ワークスペース) は既定で kp2 を起動したディレクトリ (`npm run dev` ならリポジトリのルート) で、`kp2 --workspace ~/src/myproject` または `KP2_WORKSPACE=~/src/myproject npm run dev` で変えられます。
ターミナルとエディタは同じローカルファイルシステムを見ているので、「手順書を読む → エディタで編集 → Run で実行 → ターミナルで結果を見る」がブラウザの中で完結します。

手順書からファイルを開くには `vscode:` リンクを書きます。パスはワークスペースからの相対パスで、`#L行番号` で行を指定できます。

```markdown
[main.rs を開く](vscode:src/main.rs#L120)
```

クリックすると kp2 の `/api/open` が `code-server -r` を実行し、動いている VS Code の該当ファイルが開きます (ページのリロードはありません)。
code-server が動いていないときは説明が表示されるだけです。

エディタペインの iframe は code-server 自身のオリジン (`http://127.0.0.1:7682/`) を指すので、ブラウザから見えるオリジンは kp2 と code-server の 2 つになります。

code-server のユーザーデータは `~/.local/share/kp2/code-server` (または `$XDG_DATA_HOME/kp2/code-server`) に置きます。
`code-server -r` が既存インスタンスを見つけるための IPC ソケットがここに作られるため、短いパスである必要があります。

## レイアウト

左の手順書と右のターミナルの境界はドラッグで動かせます。幅はブラウザに記憶されます。エディタを表示しているときは、エディタとターミナルの境界も同様にドラッグできます。

## ターミナル操作

- 通常のキー入力、Ctrl-C などの制御キーはそのまま shell に届きます
- コピー: 選択して Cmd+C (macOS) / Ctrl+Shift+C。ペースト: Cmd+V / Ctrl+Shift+V
- ウィンドウ/ペインのサイズ変更に追従して PTY を resize します
- 接続が切れた場合はターミナル上部の **Reconnect** で再接続できます

## セキュリティ

このツールはローカルマシン上で任意のコマンドを実行できます。

- kp2 も code-server も Vite も **127.0.0.1 のみ** にバインドします。外部ネットワークには公開しないでください。code-server は `--auth none` で起動しており、localhost 以外に公開すると誰でも操作できてしまいます
- ターミナルの WebSocket は `Origin` ヘッダを検証し、localhost 以外のページからの接続を拒否します。`--allowed-origin` で指定したオリジンは例外として許可します。kp2 自体には認証がないので、許可したオリジンではプロキシ側で認証をかけてください
- Run ボタンが送る内容は、画面に表示されているコードブロックの内容そのものです。隠しコマンドや変換はありません
- Markdown を開いただけでは何も実行されません。実行は必ずボタン操作かキー入力によります
- 認証はありません (MVP)。信頼できるローカル環境でのみ使ってください

## 構成

```
docs/getting-started.md   手順書 (Markdown、デフォルトのディレクトリ)
server/                   Rust backend (単一バイナリ kp2)
  src/main.rs             CLI、ルーティング、同梱 UI の配信
  src/pty.rs              WebSocket 接続ごとの PTY、ターミナルのワイヤプロトコル、Origin 検証
  src/docs.rs             任意ディレクトリの .md 一覧と本文、フォルダ監視
  src/favorites.rs        favorites.json の読み書き
  src/editor.rs           code-server の起動、稼働確認、ファイルを開く API
  src/events.rs           server-sent events (/api/events)
vite.config.ts            dev server の localhost bind と kp2 へのプロキシ
src/terminal.ts           ターミナルプロトコルの WebSocket クライアント (入力、出力、resize、フロー制御)
src/TerminalPane.tsx      xterm.js + fit addon + resize/copy/paste
src/Guide.tsx             Markdown レンダリングと Copy / Insert / Run、リンク処理
src/docs.ts               手順書ストア (サーバー経由 / File System Access API の 2 系統)、手順書の選択、お気に入り
src/DocsPicker.tsx        ヘッダーのフォルダ / 手順書セレクタとフォルダ選択パネル
src/editor.ts             エディタの稼働状態、表示のオン / オフ、vscode: リンクの解釈
src/EditorToggle.tsx      ヘッダーの Editor ボタン
src/SplitPane.tsx         エディタ / ターミナルの上下分割 (ドラッグで比率変更)
src/App.tsx               2 ペインレイアウト
```
