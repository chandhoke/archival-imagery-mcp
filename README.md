# archival-imagery-mcp

> An MCP server for browsing and downloading open-licensed imagery from six major museum and archive APIs. Built for editorial projects that need **authored, archival visual material** instead of AI-generated stock.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node 18+](https://img.shields.io/badge/Node-18%2B-339933.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-compatible-7C3AED.svg)](https://modelcontextprotocol.io/)

## What this is

When Claude or any other MCP-compatible client needs imagery for an editorial project — a service site, a long-form article, a brand book, a deck — generating images from scratch usually produces something that *reads as AI*. For brands with editorial bona fides, that signal is fatal.

This server gives the assistant a different option: search the world's open-access museum collections for **authored, attributed, often-centuries-old imagery** and download it straight into the project's `public/` folder. Most results are CC0, CC-BY, or Public Domain Mark — usable with no licensing friction.

## Sources

| Source | Coverage | API Key | License Defaults |
|---|---|---|---|
| **Wellcome Collection** | UK. Medical, scientific, esoteric, astrological history. ~250k items. | No | CC-BY / PDM |
| **Met Museum** | US. Open Access program. ~470k objects, all CC0 when public domain. | No | CC0 |
| **Library of Congress** | US. Photos, manuscripts, maps, prints, newspapers, film. ~1M items. | No | Mostly PD |
| **Smithsonian Open Access** | US. 4.5M+ CC0 items across 21 museums. | Free | CC0 |
| **Europeana** | EU aggregator — British Library, Louvre, **full Rijksmuseum collection**, plus 4000+ institutions. | Free | Mixed (filterable) |

> **Note on Rijksmuseum:** the Rijksmuseum's REST API was deprecated in 2024 in favour of OAI-PMH (an XML harvesting protocol designed for institutional bulk-download, not query-by-keyword). Rather than re-implement on a less query-friendly protocol, this server intentionally omits direct Rijksmuseum support. Europeana fully indexes the Rijksmuseum collection — query it via `europeana_search` with `provider="Rijksmuseum"`.

## Installation

### From source (current method)

```bash
git clone https://github.com/chandhoke/archival-imagery-mcp.git
cd archival-imagery-mcp
npm install
```

Then add to your MCP client's config. For **Claude Code Desktop** (`~/.claude.json` or `%USERPROFILE%\.claude.json`):

```json
{
  "mcpServers": {
    "archival-imagery": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/archival-imagery-mcp/index.mjs"],
      "env": {
        "SMITHSONIAN_API_KEY": "your-key-here-or-omit",
        "EUROPEANA_API_KEY": "your-key-here-or-omit"
      }
    }
  }
}
```

API keys are **all optional** — Wellcome, Met, and Library of Congress work without keys. Smithsonian and Europeana tools return a helpful error message with the signup URL if their key is missing.

### From npm (coming soon)

A future release will be published to npm so you can install with `npm install -g archival-imagery-mcp` and point the config at `npx archival-imagery-mcp`. For now, install from source above.

## Getting the optional API keys

All free, all take under 2 minutes:

- **Smithsonian:** [api.data.gov/signup/](https://api.data.gov/signup/) — email confirmation. The same key works for NASA, NOAA, FCC, and most US government APIs.
- **Europeana:** [pro.europeana.eu/page/get-api](https://pro.europeana.eu/page/get-api) — instant. Covers British Library, Rijksmuseum, Louvre, and 4000+ other institutions in one endpoint.

## Tools (12 total)

### Search & retrieval

| Tool | Source | Needs Key |
|---|---|---|
| `wellcome_search` | Wellcome | — |
| `wellcome_get_work` | Wellcome | — |
| `wellcome_image_url` | Wellcome (utility) | — |
| `met_search` | Met | — |
| `met_get_object` | Met | — |
| `loc_search` | Library of Congress | — |
| `loc_get_item` | Library of Congress | — |
| `smithsonian_search` | Smithsonian | ✓ |
| `smithsonian_get_object` | Smithsonian | ✓ |
| `europeana_search` | Europeana | ✓ |
| `europeana_get_record` | Europeana | ✓ |

### Shared utility

| Tool | Purpose |
|---|---|
| `download_image` | Save any image URL (from any of the above) to a local path. Creates parent dirs automatically. |

## Usage examples (natural language)

Once installed, just describe what you want and the assistant picks the right tool:

> *"Find Indian astrology pieces at the Met that we could use on /method — show me 5."*

> *"Search Wellcome for nakshatra diagrams and save the best two to my project's public/brand/ folder."*

> *"Use Europeana with provider='Rijksmuseum' to find Vermeer paintings — I want a portrait for the about page."*

> *"Use Europeana to find anything from the British Library tagged 'Sanskrit manuscript' — only CC0/CC-BY please."*

## Attribution

When using imagery from any of these sources in published work, **always check the per-item license** (returned with every result) and follow its attribution requirements. Most CC-BY items only need a short credit line:

```
Imagery courtesy of [Source] (CC BY 4.0).
```

CC0 / Public Domain Mark items have no attribution requirement but crediting the source is good practice.

## Architecture

- Single-file MCP server (`index.mjs`), ~400 lines
- Native `fetch` (Node 18+), no HTTP library dependency
- Only one dependency: `@modelcontextprotocol/sdk`
- No telemetry, no persistent state, no auth required for the server itself
- Stateless — every tool call hits the upstream API fresh

## Extending

To add another source (e.g. New York Public Library Digital Collections, DPLA, Gallica):

1. Add a section under `// =========================================================================` with `xyzSearch`, `xyzGetObject` functions
2. Add an env-var helper if it needs a key (use the existing `requireKey` pattern)
3. Add entries to the `TOOLS` array with clear descriptions
4. Add entries to the `HANDLERS` map

~50 lines per new source.

## License

MIT © Harpreet Chandhoke

This server is a client for third-party APIs. Each source has its own terms — respect them in your usage. The MIT license applies only to this server code, not to the content retrieved.
