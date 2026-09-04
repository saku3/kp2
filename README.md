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

本番ビルドを試す場合は `npm run build && npm start` です (Vite preview + ttyd、同じポート構成)。

## 手順書

`docs/*.md` に置いた Markdown がすべて読み込まれます。デフォルトは `docs/getting-started.md` で、
`?doc=<ファイル名>` で切り替えられます (複数ある場合はヘッダーにセレクタが出ます)。
Vite の HMR が効くので、Markdown を編集すると即座に反映されます。

コードブロックの言語が `bash` / `sh` / `shell` のときだけボタンが表示されます。

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
docs/getting-started.md   手順書 (Markdown)
scripts/ttyd.sh           ttyd 起動スクリプト (localhost bind, shell 選択)
vite.config.ts            dev/preview server の localhost bind と ttyd へのプロキシ
src/ttyd.ts               ttyd WebSocket プロトコルの最小クライアント
src/TerminalPane.tsx      xterm.js + fit addon + resize/copy/paste
src/Guide.tsx             Markdown レンダリングと Run / Insert ボタン
src/App.tsx               2 ペインレイアウトと Markdown 選択
```

## ttyd を選んだ理由

ttyd の WebSocket プロトコルは非常に単純で (先頭 1 バイトがコマンド種別、`'0'`=入力、`'1'`=resize)、
ttyd 同梱の Web UI を使わずとも xterm.js から直接話せます。
そのため PTY 管理・resize・シグナル処理を自前で持つ必要がなく、backend は ttyd のプロセス 1 つだけです。
