-- ArkTS LSP configuration for Neovim 0.11+ (`vim.lsp.config` / `vim.lsp.enable`).
--
-- Put this in your init.lua, or in a file under `~/.config/nvim/` that you
-- `require`. The `arkts-lsp` binary must be on PATH (see the README) — or set
-- `cmd` to an absolute path, e.g.:
--   cmd = { "node", "/path/to/arkts-lsp/dist/cli.js" },

-- 1. Teach Neovim about ArkTS files. ArkTS uses the `.ets` extension (and
--    `.d.ets` for declarations — the last extension is still `ets`). The server
--    does not care about the filetype name (it detects the language from the
--    file extension), so map to a dedicated `arkts` filetype.
vim.filetype.add({
  extension = { ets = "arkts" },
})

-- Optional: reuse the TypeScript parser for highlighting if you have it.
-- pcall(vim.treesitter.language.register, "typescript", "arkts")

-- 2. Define and enable the server.
vim.lsp.config("arkts", {
  cmd = { "arkts-lsp" },
  filetypes = { "arkts" },

  -- Start the server when one of these is found walking up from the file.
  -- `build-profile.json5` is the HarmonyOS project root marker.
  root_markers = { "build-profile.json5", ".git" },

  -- The proxy injects ace-server's required initializationOptions itself, so
  -- nothing is needed here. `ARKTS_*` settings are read from the environment.
  -- init_options = {},

  settings = {},
})

vim.lsp.enable("arkts")
