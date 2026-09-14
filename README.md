# arkts-lsp

**English** | [中文](README.zh-CN.md)

> Thanks to **[HelloiOS2014/harmony_arkts_lsp_proxy](https://github.com/HelloiOS2014/harmony_arkts_lsp_proxy)**
> — the `arkts-lsp-proxy` npm package this project is built on.

A standalone ArkTS / ArkUI language server for Linux (and any OS with Node.js).

It **combines two existing things** so you do not need the multi-gigabyte DevEco
Studio IDE:

| Combines | Role |
| --- | --- |
| Huawei **DevEco Studio** → its `ace-server` language server (extracted, bundled into the release) | does the actual ArkTS language intelligence |
| **[HelloiOS2014/harmony_arkts_lsp_proxy](https://github.com/HelloiOS2014/harmony_arkts_lsp_proxy)** → the `arkts-lsp-proxy` npm package (used unmodified) | injects project metadata and translates LSP ↔ `ace-server`'s private protocol |
| Your **official HarmonyOS command-line tools** | SDK, Node.js runtime, hvigor |

This repository is a **thin wrapper** around the upstream `arkts-lsp-proxy` and
DevEco Studio's `ace-server`: it contains no proxy or language-server code, only
an extractor and a small launcher that wire them together.

```
editor ──stdio──► arkts-lsp (launcher, this repo)
                      └─ execs arkts-lsp-proxy (upstream) ──spawns──► ace-server
```

## Requirements

1. **Official HarmonyOS command-line tools** on `PATH`:
   ```sh
   export PATH="/path/to/commandline-tools/bin:$PATH"
   ```
2. **`arkts-lsp`** — one download, already includes `ace-server`:
   ```sh
   npm install -g ./arkts-lsp-<version>.tgz
   ```
   That is all you need; `arkts-lsp-proxy` (upstream) and a DevEco `ace-server`
   build are pulled from / bundled inside this tarball.

## Usage

```sh
arkts-lsp doctor     # show what was found / what is missing
arkts-lsp            # run the LSP server on stdio (editors spawn this)
```

On start the launcher finds `ace-server` (bundled in the package, or a separate
bundle you extracted) plus the command-line tools, assembles a DevEco-shaped home
(`~/.local/share/arkts-lsp/dev-home/`, just symlinks: `plugins`, `sdk`,
`tools/node`, `tools/hvigor`), and runs the upstream proxy with `DEVECO_HOME`
pointing at it.

To use a different `ace-server` build than the bundled one:

```sh
arkts-lsp setup --from ~/Downloads/devecostudio-mac.zip
# or: tar -xzf ace-server-<version>.tar.gz -C ~/.local/share/arkts-lsp
```

### Neovim 0.11+ (`vim.lsp.config`)

```lua
vim.filetype.add({ extension = { ets = 'arkts' } })

vim.lsp.config('arkts', {
  cmd = { 'arkts-lsp' },
  filetypes = { 'arkts' },
  root_markers = { 'build-profile.json5', '.git' },
})

vim.lsp.enable('arkts')
```

A ready-to-copy version is in [`examples/nvim/arkts.lua`](examples/nvim/arkts.lua).

### Extracting `ace-server` directly

`arkts-lsp-extract --from <devecostudio-mac.zip | .dmg | .app | install> --out dist`

## Environment variables

| Variable | Purpose |
| --- | --- |
| `ARKTS_LSP_HOME` | Where ace-server bundles live. Default: `~/.local/share/arkts-lsp`. |
| `ARKTS_ACE_SERVER_HOME` | A specific bundle (dir containing `plugins/openharmony/ace-server`). |
| `ARKTS_CLI_HOME` | Command-line tools root. Auto-detected from `hvigorw` on `PATH`. |
| `DEVECO_HOME` | A full DevEco Studio install; used as-is when valid. |
| `ARKTS_LSP_SYNC` | Upstream proxy: `auto` (default) / `off` / `force`. |

## Credits

- [HelloiOS2014/harmony_arkts_lsp_proxy](https://github.com/HelloiOS2014/harmony_arkts_lsp_proxy) (MIT) — the LSP proxy, used as a dependency.
- [alex3236/devecostudio-linux](https://github.com/alex3236/devecostudio-linux) (BSD-2-Clause) — Linux porting notes.

## License

MIT for the tooling here. `ace-server` is Huawei proprietary software and is
**not** covered by this license — see [`NOTICE`](NOTICE) and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
