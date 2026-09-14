# arkts-lsp

[English](README.md) | **中文**

> 感谢 **[HelloiOS2014/harmony_arkts_lsp_proxy](https://github.com/HelloiOS2014/harmony_arkts_lsp_proxy)**
> —— 本项目所基于的 LSP 代理。本仓库以 git submodule 方式引入了它的一个 fork
> ([PEMessage/harmony_arkts_lsp_proxy](https://github.com/PEMessage/harmony_arkts_lsp_proxy))。

可独立运行的 ArkTS / ArkUI 语言服务器(Linux 优先,任何有 Node.js 的系统都能用)。

它**把两样现成的东西组合起来**,这样你就不需要几个 GB 的 DevEco Studio IDE:

| 组合 | 作用 |
| --- | --- |
| Huawei **DevEco Studio** 里的 `ace-server`(抽离出来,打进发布包) | 真正提供 ArkTS 语言智能 |
| **[harmony_arkts_lsp_proxy](https://github.com/HelloiOS2014/harmony_arkts_lsp_proxy) 的 fork**(git submodule,编译到 `dist/`) | 注入项目元数据,并在 LSP ↔ `ace-server` 私有协议之间转换 |
| 你本机的**官方 HarmonyOS command-line tools** | SDK、Node.js、hvigor |

本仓库只是一个**薄封装(thin wrapper)**:除抽取器和一个小启动器外,不添加任何自己的代理或语言服务代码。

```
编辑器 ──stdio──► arkts-lsp (启动器,本仓库)
                     └─ exec 内置的 arkts-lsp-proxy ──spawn──► ace-server
```

## 前置条件

1. **官方 HarmonyOS command-line tools** 加入 `PATH`:
   ```sh
   export PATH="/path/to/commandline-tools/bin:$PATH"
   ```
2. **`arkts-lsp`** —— 只下载一个就够,里面已经包含 `ace-server`:
   ```sh
   npm install -g ./arkts-lsp-<version>.tgz
   ```
   内置的 `arkts-lsp-proxy` fork(编译产物)和 DevEco 的 `ace-server` 都打进这个包里,
   不再需要单独下载。

## 用法

```sh
arkts-lsp doctor     # 看环境里有什么、缺什么
arkts-lsp            # 在 stdio 上跑 LSP(编辑器会自动调用)
```

启动时,启动器会找到 `ace-server`(包内自带,或你单独解压的 bundle)和 command-line
tools,拼出一个 DevEco 形状的 home(`~/.local/share/arkts-lsp/dev-home/`,全是软链接:
`plugins`、`sdk`、`tools/node`、`tools/hvigor`),然后用 `DEVECO_HOME` 指向它运行上游代理。

想用别的 `ace-server` 版本:

```sh
arkts-lsp setup --from ~/Downloads/devecostudio-mac.zip
# 或:tar -xzf ace-server-<version>.tar.gz -C ~/.local/share/arkts-lsp
```

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

## 开发

```sh
git clone --recurse-submodules <本仓库>
npm install
npm test          # 先构建内置代理,再跑抽取器 + 启动器端到端测试
```

代理 fork 是位于 `vendor/harmony_arkts_lsp_proxy` 的 git submodule;用
`npm run build:proxy`(或 `scripts/build-proxy.sh --force`)构建。给代理打补丁请在
fork 自己的克隆里改,然后在这里更新 submodule 指针。

## 致谢

- [HelloiOS2014/harmony_arkts_lsp_proxy](https://github.com/HelloiOS2014/harmony_arkts_lsp_proxy)(MIT)—— 原始 LSP 代理。
- [PEMessage/harmony_arkts_lsp_proxy](https://github.com/PEMessage/harmony_arkts_lsp_proxy)—— 本仓库以 git submodule 引入的 fork。
- [alex3236/devecostudio-linux](https://github.com/alex3236/devecostudio-linux)(BSD-2-Clause)—— Linux 移植笔记。

## 许可

本仓库工具代码为 MIT。`ace-server` 是 Huawei 私有软件,**不**在 MIT 许可范围内 —— 见
[`NOTICE`](NOTICE) 与 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
