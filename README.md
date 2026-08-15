# dsh-plugin-doctor

[![CI](https://github.com/zoahdev/dsh-plugin-doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/zoahdev/dsh-plugin-doctor/actions) [![Release](https://img.shields.io/github/v/release/zoahdev/dsh-plugin-doctor)](https://github.com/zoahdev/dsh-plugin-doctor/releases)

[English](#english) · [中文](#中文)

## English

Health checks for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugins — the practical answer to the `dsh plugin check` idea from [RFC #1629](https://github.com/deepseek-ai/deepseek-harness/discussions/1629), until the official command exists.

It works in two ways:

- **CLI** (`dsh-plugin-doctor` / `node lib/bin.js`) — run it in your terminal or CI before opening a PR.
- **Plugin shell** (`dsh plugin add`) — once installed in DeepSeek Harness, the agent can call the `plugin_check` tool directly: "check whether this plugin is ready to publish", no shell needed.

### What it checks

| Check | What it verifies | Default |
|---|---|---|
| `manifest` | `package.json` exists; `dsh.bundle` + `dsh.bundle.patch` + `prepare` + `main` present | ✅ |
| `patch` | `cordis.patch.yml` parses as YAML and contains at least one `insert` row with an `id` | ✅ |
| `entry` | `main` target exists (warns when not built yet) | ✅ |
| `files` | a `files` allowlist is declared | ✅ |
| `build` | `pnpm run build` succeeds | `--build` |
| `pack` + `install` + `config` | `pnpm pack`, install into a fresh `DSH_HOME` profile, and confirm the plugin id in `--dump-config` | `--full` |
| `profile-shadow` | a dsh profile has no real-directory `@deepseek-ai/*` copy shadowing the host instance (discussion #1697) | `--profile <dir>` |
| `manifest-bom` | a dsh profile's `package.json` has no UTF-8 BOM (crashes `dsh web` at boot, discussion #1842) | `--profile <dir>` |
| `large-files` | no profile file exceeds 100 MB (session logs can hit the ~512 MB stringify cap, discussion #1859) | `--profile <dir>` |
| `pre-execute-side-effects` | pre-execute listeners do not run host-level side effects before approval (heuristic lint, discussion #1863) | default pipeline |
| `node` / `pnpm` / `dsh-path` / `port-3080` / `win-bash` | environment diagnostics: toolchain on PATH, Web UI port free, and Windows bash resolvable for the minimal preset (discussion #1856) | `--env` |

Exit code is `0` when nothing failed, `1` otherwise. `--json` prints a machine-readable report for CI.

### CLI usage

```sh
npx dsh-plugin-doctor .                 # quick checks on the current directory
npx dsh-plugin-doctor --build ./my-plugin
npx dsh-plugin-doctor --full ./my-plugin
npx dsh-plugin-doctor preflight ./my-plugin       # alias: build + full pipeline (discussion #1774)
npx dsh-plugin-doctor check ./my-plugin           # same pipeline; matches the proposed `dsh plugin check` surface (RFC #1846)
npx dsh-plugin-doctor --json ./my-plugin
npx dsh-plugin-doctor --profile ~/.dsh/profiles/web   # profile tripwire: host-shadowing + manifest BOM
npx dsh-plugin-doctor --env                            # environment diagnostics (node/pnpm/dsh PATH, port 3080)
npx dsh-plugin-doctor --env --port 8090                # probe a custom web port instead
npx dsh-plugin-doctor --help
```

Run from the repo without installing (after `pnpm build`):

```sh
node lib/bin.js --full ./my-plugin
```

### Plugin usage (agent-callable)

Install the plugin into a DeepSeek Harness profile:

```sh
dsh plugin --profile web add dsh-plugin-doctor   # from npm
# or from a local build:
dsh plugin --profile web add ./dsh-plugin-doctor-1.6.0.tgz
```

Then ask the agent inside DSH:

> 检查一下这个插件能不能发布 —— 先跑 build，再做完整验证。
> Check whether this plugin is ready to publish — run the build first, then do a full verification.

The agent calls the `plugin_check` tool (`dir`, optional `build`/`full` flags). The tool returns PASS/WARN/FAIL per check plus an overall `ok` flag.

### What "full" really proves

`--full` does not just load the bundle. It:

1. runs `pnpm pack` on the real project;
2. creates a fresh `DSH_HOME` profile (no pollution of your real one);
3. runs `dsh plugin add <tarball>`;
4. runs `dsh --dump-config` and asserts the plugin id from `cordis.patch.yml` actually appears in the composed config.

CI also runs a real-registry agent-visibility check: a real Cordis context + real dsh-tools ToolRuntime + a scoped agent view, asserting `plugin_check` is visible through `ctx.tools.schemas(scope)` — the mechanism agents actually use (covers the dual-instance shadowing class from discussions #1697/#1782).

This is the same path the [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) maintainers use when they review plugin PRs.

### Why it exists

- pnpm can silently link an older RC into a plugin's peer slot, and "loads fine" does not mean "works" (see the [template](https://github.com/zoahdev/dsh-plugin-template) runtime guard and [troubleshooting](https://github.com/zoahdev/dsh-plugin-template#troubleshooting)).
- A repeatable local check (manifest → build → install → config) catches the failures that only show up on other people's machines.
- The `dsh web` boot step currently runs on Windows in CI because the upstream npm CLI lacks the linux-x64 `pty.node` prebuild ([discussion #1686](https://github.com/deepseek-ai/deepseek-harness/discussions/1686)); doctor's install/config verification is platform-independent.
- A profile-hoisted real-directory copy of `@deepseek-ai/dsh-tools` can shadow the host instance and crash every tool call ([discussion #1697](https://github.com/deepseek-ai/deepseek-harness/discussions/1697)); `--profile` flags exactly that precondition before anything boots.
- A UTF-8 BOM in a profile's `package.json` crashes `dsh web` at boot with `Unexpected token` ([discussion #1842](https://github.com/deepseek-ai/deepseek-harness/discussions/1842)); the `manifest-bom` check catches it before boot.
- Environment friction (missing pnpm, Node version, PATH, occupied web port) is the other big setup-time failure class; `--env` turns it into one command (the `dsh doctor` idea from [discussion #1719](https://github.com/deepseek-ai/deepseek-harness/discussions/1719)).

### Related community tools

- [moonquake2004/dsh-doctor](https://github.com/moonquake2004/dsh-doctor) — offline profile/session/env diagnostics with 19 checks mapped to community failure reports. Complementary: dsh-plugin-doctor covers the pre-publish plugin path, dsh-doctor covers the offline profile/session path. Its P5 check and our `profile-shadow` check flag the same host-shadowing precondition from two sides.

### CI

The repository CI runs:

`pnpm install --frozen-lockfile` → `typecheck` → `build` → unit tests → **packaged plugin-shell smoke** (pack → fresh host install → load `lib/plugin.js` → register `plugin_check` → call the real handler → assert result) → CLI smoke → **full doctor self-check** (pack → fresh `DSH_HOME` profile → `dsh plugin add` → `--dump-config`).

### Development

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm test:integration
```

### License

MIT © 2026 zoahdev

---

## 中文

**dsh-plugin-doctor** —— [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件的健康检查工具，是 [RFC #1629](https://github.com/deepseek-ai/deepseek-harness/discussions/1629) 中 `dsh plugin check` 提案在官方命令落地前的实际实现。

它有两种使用方式：

- **CLI**（`dsh-plugin-doctor` / `node lib/bin.js`）——在终端或 CI 里跑，适合提 PR 前自检。
- **插件外壳**（`dsh plugin add`）——装进 DeepSeek Harness 后，agent 可以直接调用 `plugin_check` 工具：说一句"检查一下我这个插件能不能发"，不用切到终端。

### 检查项

| 检查 | 验证内容 | 默认 |
|---|---|---|
| `manifest` | `package.json` 存在；`dsh.bundle`、`dsh.bundle.patch`、`prepare`、`main` 齐全 | ✅ |
| `patch` | `cordis.patch.yml` 是合法 YAML，且至少有一条带 `id` 的 `insert` | ✅ |
| `entry` | `main` 指向的文件存在（未构建时给 WARN） | ✅ |
| `files` | 声明了 `files` 白名单 | ✅ |
| `build` | `pnpm run build` 成功 | `--build` |
| `pack`+`install`+`config` | `pnpm pack`，装进全新 `DSH_HOME` profile，并在 `--dump-config` 里确认插件 id | `--full` |
| `profile-shadow` | dsh profile 顶层没有真实目录形式的 `@deepseek-ai/*` 副本遮蔽宿主实例（讨论 #1697） | `--profile <dir>` |
| `node` / `pnpm` / `dsh-path` / `port-3080` / `win-bash` | 环境诊断：工具链在 PATH 上、Web UI 端口空闲、Windows bash 可解析（minimal 预设，讨论 #1856） | `--env` |

退出码：全部通过为 `0`，否则为 `1`。`--json` 输出机器可读报告，方便接入 CI。

### CLI 用法

```sh
npx dsh-plugin-doctor .                 # 对当前目录做快速检查
npx dsh-plugin-doctor --build ./my-plugin
npx dsh-plugin-doctor --full ./my-plugin
npx dsh-plugin-doctor preflight ./my-plugin       # 别名：build + 全链路（讨论 #1774）
npx dsh-plugin-doctor check ./my-plugin           # 同 pipeline；对应 RFC #1846 的 `dsh plugin check` 命名
npx dsh-plugin-doctor --json ./my-plugin
npx dsh-plugin-doctor --profile ~/.dsh/profiles/web   # profile 级宿主遮蔽 tripwire
npx dsh-plugin-doctor --env                            # 环境诊断（node/pnpm/dsh PATH、3080 端口）
npx dsh-plugin-doctor --env --port 8090                # 探测自定义端口
npx dsh-plugin-doctor --help
```

不全局安装也可以（先 `pnpm build`）：

```sh
node lib/bin.js --full ./my-plugin
```

### 插件用法（agent 可直接调用）

装进 DeepSeek Harness profile：

```sh
dsh plugin --profile web add dsh-plugin-doctor   # 从 npm 安装
# 或本地构建产物：
dsh plugin --profile web add ./dsh-plugin-doctor-1.5.0.tgz
```

然后在 DSH 里直接对 agent 说：

> 检查一下这个插件能不能发布 —— 先跑 build，再做完整验证。

agent 会调用 `plugin_check` 工具（参数 `dir`，可选 `build`/`full`），逐项返回 PASS/WARN/FAIL 和整体 `ok` 标志。

### `--full` 真正验证了什么

不是"能加载"就算过，而是：

1. 对真实项目执行 `pnpm pack`；
2. 创建全新 `DSH_HOME` profile（不污染真实配置）；
3. 执行 `dsh plugin add <tarball>`；
4. 执行 `dsh --dump-config`，断言 `cordis.patch.yml` 里的插件 id 真的出现在合成配置里。

这条路径与 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 维护者人工审插件 PR 的流程一致。

### 为什么需要它

- pnpm 可能把旧 RC 静默链进插件的 peer 槽；"能加载"不等于"能用"（参见[模板](https://github.com/zoahdev/dsh-plugin-template)的运行时守卫与[故障排查](https://github.com/zoahdev/dsh-plugin-template#troubleshooting)）。
- 本地可重复检查（manifest → build → 安装 → 配置）能提前抓出只在别人机器上才会爆的错。
- 因为上游 npm CLI 目前缺 linux-x64 的 `pty.node` 预编译（[#1686](https://github.com/deepseek-ai/deepseek-harness/discussions/1686)），`dsh web` 启动冒烟在 CI 的 Windows runner 上执行；doctor 的安装/配置验证与平台无关。
- profile 顶层若出现真实目录形式的 `@deepseek-ai/dsh-tools` 副本，会遮蔽宿主实例并让每次工具调用崩溃（[#1697](https://github.com/deepseek-ai/deepseek-harness/discussions/1697)）；`--profile` 在启动前就能把这个前置条件抓出来。
- 环境类故障（缺 pnpm、Node 版本、PATH、Web 端口被占）是另一大 setup 期痛点；`--env` 一条命令全查（[#1719](https://github.com/deepseek-ai/deepseek-harness/discussions/1719) 的 `dsh doctor` 设想）。

### 相关社区工具

- [moonquake2004/dsh-doctor](https://github.com/moonquake2004/dsh-doctor) —— 离线 profile/session/env 诊断（19 项检查，映射到社区故障报告）。与 dsh-plugin-doctor 互补：我们管发布前插件路径，它管离线 profile/session 路径；它的 P5 检查与我们的 `profile-shadow` 检查从两个方向标记同一个宿主遮蔽前置条件。

### CI

仓库 CI 完整流程：

`pnpm install --frozen-lockfile` → `typecheck` → `build` → 单元测试 → **打包插件外壳冒烟**（pack → 全新宿主安装 → 加载 `lib/plugin.js` → 注册 `plugin_check` → 真实调用 handler → 断言结果）→ CLI 冒烟 → **doctor 自检**（pack → 全新 `DSH_HOME` profile → `dsh plugin add` → `--dump-config`）。

### 开发

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm test:integration
```

### 许可证

MIT © 2026 zoahdev
