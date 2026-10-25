# Getting Started

まず現在のディレクトリを確認します。

```bash
pwd
```

次にファイル一覧を確認します。**Run** ボタンの代わりに、コード部分を**ダブルクリック**しても実行できます。

```bash
ls -la
```

複数行のコマンドもそのまま実行できます。

```bash
for i in 1 2 3; do
  echo "hello $i"
done
```

**Insert** は入力だけしてEnterを押しません。編集してから実行したいときに使います。

```sh
echo "edit me before running"
```

**Copy** はコードブロックの内容をクリップボードにコピーします。ターミナル以外の場所に貼り付けたいときに使います。

```bash
echo "copy me"
```

`{{NAME}}` のように二重の波括弧で囲った文字列は変数として扱われ、ブラウザ上でクリックして値を入力できます。値は手順書ごとに保存され、同じ手順書の中では同じ名前の変数がすべて同じ値になります。値を入れるまで Run と Insert は押せません。

```sh
echo {{TEST}}
```

`bash` / `sh` / `shell` 以外のコードブロックには Run ボタンは付きませんが、Copy は使えます。

```json
{ "note": "this is not runnable" }
```

```sh
uname -a
```


```sh
limactl shell ubuntu-26.04
```

```sh
uname -a
```

## エディタと連携する

code-server が入っていると右ペインの上にブラウザ版 VS Code が出ます。手順書からファイルを開くこともできます。

[README.md を開く](vscode:README.md) / [src/App.tsx の 20 行目を開く](vscode:src/App.tsx#L20)

リンクの書き方は `[表示名](vscode:ワークスペースからの相対パス#L行番号)` です。
