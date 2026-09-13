# arkts-lsp

[English](README.md) | **中文**

> 感谢 **[HelloiOS2014/harmony_arkts_lsp_proxy](https://github.com/HelloiOS2014/harmony_arkts_lsp_proxy)**
> —— 本项目所构建的 `arkts-lsp-proxy` npm 包。

可独立运行的 ArkTS / ArkUI 语言服务器(Linux 优先,任何有 Node.js 的系统都能用)。

它**把两样现成的东西组合起来**,这样你就不需要几个 GB 的 DevEco Studio IDE:

| 组合 | 作用 |
| --- | --- |
| Huawei **DevEco Studio** 里的 `ace-server`(抽离出来) | 真正提供 ArkTS 语言智能 |
| **[HelloiOS2014/harmony_arkts_lsp_proxy](https://github.com/HelloiOS2014/harmony_arkts_lsp_proxy)** 的 `arkts-lsp-proxy` npm 包(原样使用) | 注入项目元数据,并在 LSP ↔ `ace-server` 私有协议之间转换 |
| 你本机的**官方 HarmonyOS command-line tools** | SDK、Node.js、hvigor |

本仓库只是一个**薄封装(thin wrapper)**:既不含代理代码,也不含语言服务代码,只有
一个抽取器和一个小启动器,把上游 `arkts-lsp-proxy` 与 DevEco Studio 的 `ace-server` 接起来。

```
编辑器 ──stdio──► arkts-lsp (启动器,本仓库)
                     └─ exec arkts-lsp-proxy (上游) ──spawn──► ace-server
```

## 前置条件

1. **官方 HarmonyOS command-line tools** 加入 `PATH`:
   ```sh
   export PATH="/path/to/commandline-tools/bin:$PATH"
   ```
2. **`arkts-lsp`**(来自本仓库 release):
   ```sh
   npm install -g ./arkts-lsp-<version>.tgz   # 会自动依赖安装 arkts-lsp-proxy
   ```
3. **`ace-server`**:从 DevEco 包抽取,或用 release 里的 bundle:
   ```sh
   arkts-lsp setup --from ~/Downloads/devecostudio-mac.zip
   # 或:tar -xzf ace-server-<version>.tar.gz -C ~/.local/share/arkts-lsp
   ```

## 用法

```sh
arkts-lsp doctor     # 看环境里有什么、缺什么
arkts-lsp            # 在 stdio 上跑 LSP(编辑器会自动调用)
```

启动时,启动器会找到 `ace-server` bundle 和 command-line tools,拼出一个 DevEco 形状的
home(`~/.local/share/arkts-lsp/dev-home/`,全是软链接:`plugins`、`sdk`、
`tools/node`、`tools/hvigor`),然后用 `DEVECO_HOME` 指向它运行上游代理。

### Neovim 0.11+(`vim.lsp.config`)

```lua
vim.filetype.add({ extension = { ets = 'arkts' } })

vim.lsp.config('arkts', {
  cmd = { 'arkts-lsp' },
  filetypes = { 'arkts' },
  root_markers = { 'build-profile.json5', '.git' },
})

vim.lsp.enable('arkts')
```

可直接复制的版本在 [`examples/nvim/arkts.lua`](examples/nvim/arkts.lua)。

### 直接抽离 `ace-server`

`arkts-lsp-extract --from <devecostudio-mac.zip | .dmg | .app | install> --out dist`

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `ARKTS_LSP_HOME` | 存放 ace-server bundle 的目录。默认 `~/.local/share/arkts-lsp`。 |
| `ARKTS_ACE_SERVER_HOME` | 指定某个 bundle(含 `plugins/openharmony/ace-server`)。 |
| `ARKTS_CLI_HOME` | command-line tools 根目录;默认从 `PATH` 的 `hvigorw` 推导。 |
| `DEVECO_HOME` | 完整 DevEco Studio 安装;有效时直接使用。 |
| `ARKTS_LSP_SYNC` | 上游代理:`auto`(默认)/ `off` / `force`。 |

## 致谢

- [HelloiOS2014/harmony_arkts_lsp_proxy](https://github.com/HelloiOS2014/harmony_arkts_lsp_proxy)(MIT)—— LSP 代理,作为依赖使用。
- [alex3236/devecostudio-linux](https://github.com/alex3236/devecostudio-linux)(BSD-2-Clause)—— Linux 移植笔记。

## 许可

本仓库工具代码为 MIT。`ace-server` 是 Huawei 私有软件,**不**在 MIT 许可范围内 —— 见
[`NOTICE`](NOTICE) 与 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
