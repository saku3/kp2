# youki: コンテナを作成して起動する

[youki](https://github.com/youki-dev/youki) の README から、ビルドしてコンテナを起動するまでの手順を抜き出したものです。
Local build は Linux のみ対応です。

## Requires

- Rust (edition 2024)
- linux kernel ≥ 5.3
- Docker (rootfs の取得に使用)
- `just` ([インストール方法](https://github.com/casey/just#installation))

## Dependencies

### Debian, Ubuntu and related distributions

```bash
sudo apt-get install    \
      pkg-config        \
      libsystemd-dev    \
      build-essential   \
      libelf-dev        \
      libseccomp-dev    \
      libclang-dev      \
      libssl-dev
```

### Fedora, CentOS, RHEL and related distributions

```bash
sudo dnf install            \
      pkg-config            \
      systemd-devel         \
      elfutils-libelf-devel \
      libseccomp-devel      \
      clang-devel           \
      openssl-devel
```

## Build

```bash
limactl shell ubuntu-26.04
```

```bash
cd /Users/ysakurai/Desktop/work/youki
```

```bash
just youki-dev # or youki-release
```

```bash
./youki -h # you can get information about youki command
```

## Create and run a container

Let's try to run a container that executes `sleep 30` with youki. This tutorial may need root permission.

```bash
mkdir -p tutorial/rootfs
```

```bash
cd tutorial
```

Use docker to export busybox into the rootfs directory.

```bash
docker export $(docker create busybox) | tar -C rootfs -xvf -
```

Then, we need to prepare a configuration file. This file contains metadata and specs for a container, such as the process to run, environment variables to inject, sandboxing features to use, etc.

```bash
../youki spec  # will generate a spec file named config.json
```

We can edit the `config.json` to add customized behaviors for container. Here, we modify the `process` field to run `sleep 30`.

```json
  "process": {
    ...
    "args": [
      "sleep", "30"
    ],

  ...
  }
```

Then we can explore the lifecycle of a container:

```bash
cd ..                                                # go back to the repository root
```

```bash
sudo ./youki create -b tutorial tutorial_container   # create a container with name `tutorial_container`
```

```bash
sudo ./youki state tutorial_container                # you can see the state the container is `created`
```

```bash
sudo ./youki start tutorial_container                # start the container
```

```bash
sudo ./youki list                                    # will show the list of containers, the container is `running`
```

```bash
sudo ./youki delete tutorial_container               # delete the container
```

Change the command to be executed in `config.json` and try something other than `sleep 30`.

## Rootless container

`youki` provides the ability to run containers as non-root user ([rootless mode](https://docs.docker.com/engine/security/rootless/)). To run a container in rootless mode, we need to add some extra options in `config.json`, other steps are same with above:

```bash
mkdir -p tutorial/rootfs
```

```bash
cd tutorial
```

Use docker to export busybox into the rootfs directory.

```bash
docker export $(docker create busybox) | tar -C rootfs -xvf -
```

```bash
../youki spec --rootless          # will generate a spec file named config.json with rootless mode
```

Modify the `args` field as you like.

```bash
../youki run rootless-container   # will create and run a container with rootless mode
```
