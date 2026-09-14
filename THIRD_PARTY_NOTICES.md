# Third-party notices

This repository's own code is MIT-licensed (see `LICENSE`). It does **not**
include any LSP proxy source; it depends on the upstream project below and runs
it unmodified.

---

## arkts-lsp-proxy (vendored fork, git submodule)

- Upstream: https://github.com/HelloiOS2014/harmony_arkts_lsp_proxy
- Fork: https://github.com/PEMessage/harmony_arkts_lsp_proxy
- Location: `vendor/harmony_arkts_lsp_proxy` (git submodule), built to `dist/`
- License: MIT (inherited from upstream)
- Role: this repository's `arkts-lsp` launcher composes the official HarmonyOS
  command-line tools and an extracted `ace-server` bundle into the DevEco-shaped
  directory that the proxy expects, then execs its built `dist/index.js`. All LSP
  proxying (initialize injection, the private `aceProject/*` mapping, hover
  normalisation, symbol fallback, hvigor sync) is provided by that project. This
  repository only builds the fork and bundles its `dist/` in the release tarball.

```
MIT License

Copyright (c) HelloiOS2014

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## devecostudio-linux

- Source: https://github.com/alex3236/devecostudio-linux
- License: BSD 2-Clause

No code from this project is included. Its porting notes informed the
understanding that DevEco Studio's `ace-server` is plain Node.js and can be
copied across platforms.

---

## Huawei DevEco Studio / ace-server

`ace-server` is Huawei proprietary software. It is **not** licensed under this
project's MIT license, is not committed to this repository, and is only
redistributed as part of release artifacts (the launcher tarball and the
standalone `ace-server` tarball) extracted from a DevEco Studio installation.
See `NOTICE`.
