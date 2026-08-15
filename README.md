# dsh-plugin-doctor

[English](#english) · [中文](#中文)

Health checks for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugins — the practical answer to the `dsh plugin check` idea from [RFC #1629](https://github.com/deepseek-ai/deepseek-harness/discussions/1629), until the official command exists.

## What it checks

| Check | What it verifies | Default |
|---|---|---|
| `manifest` | `package.json` exists; `dsh.bundle` + `dsh.bundle.patch` + `prepare` + `main` present | ✅ |
| `patch` | `cordis.patch.yml` parses as YAML and contains at least one `insert` row with an `id` | ✅ |
| `entry` | `main` target exists (warns when not built yet) | ✅ |
| `files` | a `files` allowlist is declared | ✅ |
| `build` | `pnpm run build` succeeds | `--build` |
| `pack` + `install` + `boot` | `pnpm pack`, install into a fresh `DSH_HOME` profile, and confirm the plugin id in `--dump-config` | `--full` |

Exit code is `0` when nothing failed, `1` otherwise. `--json` prints a machine-readable report for CI.

## Usage

```sh
dsh-plugin-doctor .                 # quick checks on the current directory
dsh-plugin-doctor --build ./my-plugin
dsh-plugin-doctor --full ./my-plugin
dsh-plugin-doctor --json ./my-plugin
dsh-plugin-doctor --help
```

Run without installing (after `pnpm build`):

```sh
node lib/bin.js --full ./my-plugin
```

## Why it exists

- pnpm can silently link an older RC into a plugin's peer slot, and "loads fine" does not mean "works" (see the [template](https://github.com/zoahdev/dsh-plugin-template) runtime guard and [troubleshooting](https://github.com/zoahdev/dsh-plugin-template#troubleshooting)).
- A repeatable local check (manifest → build → install → config) catches the failures that only show up on other people's machines.
- The `dsh web` boot step runs on Windows in CI because the upstream npm CLI currently lacks the linux-x64 `pty.node` prebuild ([discussion #1686](https://github.com/deepseek-ai/deepseek-harness/discussions/1686)).

## Development

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

## License

MIT © 2026 zoahdev

---

## 中文

**dsh-plugin-doctor** —— [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件的健康检查工具，是 [RFC #1629](https://github.com/deepseek-ai/deepseek-harness/discussions/1629) 中 `dsh plugin check` 提案在官方命令落地前的实际实现。

## 检查项

| 检查 | 验证内容 | 默认 |
|---|---|---|
| `manifest` | `package.json` 存在；`dsh.bundle`、`dsh.bundle.patch`、`prepare`、`main` 齐全 | ✅ |
| `patch` | `cordis.patch.yml` 是合法 YAML，且至少有一条带 `id` 的 `insert` | ✅ |
| `entry` | `main` 指向的文件存在（未构建时给 WARN） | ✅ |
| `files` | 声明了 `files` 白名单 | ✅ |
| `build` | `pnpm run build` 成功 | `--build` |
| `pack`+`install`+`boot` | `pnpm pack`，装进全新 `DSH_HOME` profile，并在 `--dump-config` 里确认插件 id | `--full` |

退出码：全部通过为 `0`，否则为 `1`。`--json` 输出机器可读报告，方便接入 CI。

## 用法

```sh
dsh-plugin-doctor .                 # 对当前目录做快速检查
dsh-plugin-doctor --build ./my-plugin
dsh-plugin-doctor --full ./my-plugin
dsh-plugin-doctor --json ./my-plugin
dsh-plugin-doctor --help
```

不全局安装也可以（先 `pnpm build`）：

```sh
node lib/bin.js --full ./my-plugin
```

## 为什么需要它

- pnpm 可能把旧 RC 静默链进插件的 peer 槽；"能加载"不等于"能用"（参见[模板](https://github.com/zoahdev/dsh-plugin-template)的运行时守卫与[故障排查](https://github.com/zoahdev/dsh-plugin-template#troubleshooting)）。
- 本地可重复检查（manifest → build → 安装 → 配置）能提前抓出只在别人机器上才会爆的错。
- 因为上游 npm CLI 目前缺 linux-x64 的 `pty.node` 预编译（[#1686](https://github.com/deepseek-ai/deepseek-harness/discussions/1686)），`dsh web` 启动冒烟在 CI 的 Windows runner 上执行。

## 开发

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

## 许可证

MIT © 2026 zoahdev
