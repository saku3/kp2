# Getting Started

まず現在のディレクトリを確認します。

```bash
pwd
```

次にファイル一覧を確認します。

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
