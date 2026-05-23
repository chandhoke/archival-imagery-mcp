# Changelog

All notable changes to `archival-imagery-mcp` will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] — 2026-05-23

First release published to npm.

### Removed
- `rijks_search` and `rijks_get_object` tools — the Rijksmuseum's REST API
  was deprecated in 2024 in favour of OAI-PMH, an XML harvesting protocol
  designed for institutional bulk-download rather than query-by-keyword.
  Re-implementing on OAI-PMH would have added significant complexity for a
  strictly worse query experience.
- `RIJKSMUSEUM_API_KEY` env var requirement.

### Changed
- README install instructions now lead with `npx archival-imagery-mcp`.
- README documents Europeana as the path to Rijksmuseum coverage —
  `europeana_search` with `provider="Rijksmuseum"` returns the full
  Rijksmuseum collection with the same image quality.
- Tool count: 14 → 12. Source count: 6 → 5.
- Package description and keywords updated to reflect the change.

## [0.2.0] — 2026-05-23 (unpublished)

Initial build. Not released to npm due to 2FA flow blocker; superseded
by 0.2.1 within the same session.

### Added
- Six archive APIs: Wellcome Collection, Met Museum, Library of Congress,
  Rijksmuseum (later removed in 0.2.1), Smithsonian Open Access, Europeana.
- 14 tools across the six sources, plus a shared `download_image` utility
  that writes any image URL to a local path.
- Env-var-based API key handling for the three sources that require keys
  (Rijksmuseum, Smithsonian, Europeana), with helpful errors and signup
  URLs when keys are missing.
- Single-file MCP server (`index.mjs`) — no build step, one dependency
  (`@modelcontextprotocol/sdk`), native `fetch`.
- MIT license, README, .gitignore, package.json metadata.

[0.2.1]: https://github.com/chandhoke/archival-imagery-mcp/releases/tag/v0.2.1
