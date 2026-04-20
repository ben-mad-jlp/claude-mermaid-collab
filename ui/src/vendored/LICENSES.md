# Third-Party Licenses — Vendored Code

This directory contains source files vendored from external projects. Each entry below documents the origin, license, scope of what was copied, and modifications made.

## t3code (chat UI)

- **Upstream:** t3code (Claude Code companion UI)
- **License:** MIT
- **Vendored at:** wave 1 of `t3-inspiration` session, 2026-04
- **Files copied:** ChatView component, message composer, shared UI primitives (button, card, tooltip, badge, select, popover, separator, scroll-area, skeleton, spinner, collapsible, textarea, toast, kbd), icon re-exports, and oklch design tokens.
- **Modifications:** adapted for mermaid-collab; refactored to prop-driven; types updated for React 19.

TODO: confirm exact copyright holder from the upstream LICENSE file when the vendor pull is finalized; the placeholder below uses a generic attribution line.

### MIT License

Copyright (c) t3code contributors

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

---

Any future vendored packages should append a new `## <package>` section following the same template.
