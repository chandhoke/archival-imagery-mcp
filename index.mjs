#!/usr/bin/env node
/**
 * archival-imagery-mcp
 * --------------------
 * MCP server exposing search / get / download tools for six museum & archive
 * APIs that publish open-licensed historical imagery. Built for editorial
 * projects that need authored, archival material instead of AI-generated
 * stock.
 *
 * Sources (alphabetical):
 *   - Europeana             (50+ EU institutions inc. British Library)  key
 *   - Library of Congress   (US, prints/photographs/manuscripts)        no key
 *   - Met Museum            (US, Open Access = CC0)                     no key
 *   - Rijksmuseum           (NL, PD post-1900)                          key
 *   - Smithsonian Open Acc. (US, 4.5M+ CC0 items)                       key
 *   - Wellcome Collection   (UK, mostly CC-BY and PDM)                  no key
 *
 * Tools (14 total):
 *   wellcome_search, wellcome_get_work, wellcome_image_url
 *   met_search, met_get_object
 *   loc_search, loc_get_item
 *   rijks_search, rijks_get_object
 *   smithsonian_search, smithsonian_get_object
 *   europeana_search, europeana_get_record
 *   download_image                          (shared, works on any URL)
 *
 * API keys (read from env vars; tools return a helpful error if missing):
 *   RIJKSMUSEUM_API_KEY     https://data.rijksmuseum.nl/object-metadata/api/
 *   SMITHSONIAN_API_KEY     https://api.data.gov/signup/
 *   EUROPEANA_API_KEY       https://pro.europeana.eu/page/get-api
 *
 * License: MIT. No telemetry. No persistent state. Native fetch only.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// ---------- shared ----------

const UA = "archival-imagery-mcp/0.2";

async function fetchJSON(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function requireKey(envName, signupURL) {
  const key = process.env[envName];
  if (!key) {
    throw new Error(
      `Missing ${envName}. Get a free key at ${signupURL} and add it to the MCP server's env in your .claude.json config.`,
    );
  }
  return key;
}

// =========================================================================
// WELLCOME COLLECTION
// =========================================================================

const WELLCOME_BASE = "https://api.wellcomecollection.org/catalogue/v2";
const WELLCOME_IIIF = "https://iiif.wellcomecollection.org/image";

function buildWellcomeImageURL(iiifId, size = "1200,") {
  const m = String(iiifId).match(/\/image\/([^/]+)/);
  const id = m ? m[1] : iiifId;
  return `${WELLCOME_IIIF}/${id}/full/${size}/0/default.jpg`;
}

async function wellcomeSearch({ query, kind = "works", pageSize = 10 }) {
  const endpoint = kind === "images" ? "images" : "works";
  const url = `${WELLCOME_BASE}/${endpoint}?query=${encodeURIComponent(query)}&pageSize=${pageSize}`;
  const data = await fetchJSON(url);
  const results = (data.results || []).map((r) => {
    if (kind === "images") {
      const iiifId = r.thumbnail?.url?.match(/\/image\/([^/]+)/)?.[1];
      return {
        id: r.id,
        title: r.source?.title || "(untitled)",
        sourceWorkId: r.source?.id,
        iiifId,
        directImageURL: iiifId ? buildWellcomeImageURL(iiifId, "1200,") : null,
        thumbnailURL: r.thumbnail?.url,
        license: r.locations?.[0]?.license?.label,
      };
    }
    return {
      id: r.id,
      title: r.title,
      workType: r.workType?.label,
      date: r.production?.[0]?.dates?.[0]?.label,
      description: r.description?.slice(0, 280),
    };
  });
  return { source: "wellcome", totalResults: data.totalResults, showing: results.length, results };
}

async function wellcomeGetWork({ id }) {
  const url = `${WELLCOME_BASE}/works/${encodeURIComponent(id)}?include=images,items,production,description,languages`;
  const data = await fetchJSON(url);
  const imageEntries = [];
  for (const item of data.items || []) {
    for (const location of item.locations || []) {
      if (location.type === "DigitalLocation" && /iiif\.wellcomecollection/.test(location.url || "")) {
        const iiifId = location.url.match(/\/image\/([^/]+)/)?.[1];
        if (iiifId) {
          imageEntries.push({
            iiifId,
            directImageURL: buildWellcomeImageURL(iiifId, "1800,"),
            thumbnailURL: buildWellcomeImageURL(iiifId, "400,"),
            license: location.license?.label,
          });
        }
      }
    }
  }
  return {
    source: "wellcome",
    id: data.id,
    title: data.title,
    workType: data.workType?.label,
    date: data.production?.[0]?.dates?.[0]?.label,
    description: data.description,
    physicalDescription: data.physicalDescription,
    languages: (data.languages || []).map((l) => l.label),
    images: imageEntries,
  };
}

function wellcomeImageURL({ iiifId, size = "1200," }) {
  return { directImageURL: buildWellcomeImageURL(iiifId, size) };
}

// =========================================================================
// MET MUSEUM
// =========================================================================

const MET_BASE = "https://collectionapi.metmuseum.org/public/collection/v1";

async function metSearch({ query, hasImages = true, isPublicDomain = true, departmentId, pageSize = 20 }) {
  const params = new URLSearchParams({ q: query });
  if (hasImages) params.set("hasImages", "true");
  if (isPublicDomain) params.set("isPublicDomain", "true");
  if (departmentId) params.set("departmentId", String(departmentId));
  const url = `${MET_BASE}/search?${params.toString()}`;
  const data = await fetchJSON(url);
  const ids = (data.objectIDs || []).slice(0, pageSize);
  const objects = await Promise.all(
    ids.map((id) => fetchJSON(`${MET_BASE}/objects/${id}`).catch(() => null)),
  );
  return {
    source: "met",
    totalResults: data.total || 0,
    showing: objects.filter(Boolean).length,
    results: objects.filter(Boolean).map((o) => ({
      objectID: o.objectID,
      title: o.title,
      artist: o.artistDisplayName,
      date: o.objectDate,
      medium: o.medium,
      department: o.department,
      culture: o.culture,
      primaryImage: o.primaryImage,
      primaryImageSmall: o.primaryImageSmall,
      isPublicDomain: o.isPublicDomain,
      objectURL: o.objectURL,
    })),
  };
}

async function metGetObject({ objectId }) {
  const data = await fetchJSON(`${MET_BASE}/objects/${objectId}`);
  return {
    source: "met",
    objectID: data.objectID,
    title: data.title,
    artist: data.artistDisplayName,
    date: data.objectDate,
    medium: data.medium,
    department: data.department,
    culture: data.culture,
    description: data.description,
    primaryImage: data.primaryImage,
    primaryImageSmall: data.primaryImageSmall,
    additionalImages: data.additionalImages || [],
    isPublicDomain: data.isPublicDomain,
    creditLine: data.creditLine,
    objectURL: data.objectURL,
  };
}

// =========================================================================
// LIBRARY OF CONGRESS (no API key)
// =========================================================================

const LOC_BASE = "https://www.loc.gov";

async function locSearch({ query, category, pageSize = 10 }) {
  // category options: 'photos', 'maps', 'newspapers', 'manuscripts', 'film-and-videos', etc.
  const path = category ? `/${category}/` : "/search/";
  const url = `${LOC_BASE}${path}?q=${encodeURIComponent(query)}&fo=json&c=${pageSize}`;
  const data = await fetchJSON(url);
  const results = (data.results || []).map((r) => ({
    id: r.id,
    title: r.title,
    date: r.date,
    description: Array.isArray(r.description) ? r.description.join(" ").slice(0, 280) : r.description,
    thumbnail: r.image_url?.[0],
    locUrl: r.url,
    rights: r.rights,
    subjects: r.subject?.slice(0, 8),
  }));
  return { source: "loc", totalResults: data.pagination?.of || results.length, showing: results.length, results };
}

async function locGetItem({ itemUrl }) {
  // itemUrl can be a full LoC URL like https://www.loc.gov/item/2003663891/
  const url = itemUrl.includes("?") ? `${itemUrl}&fo=json` : `${itemUrl}?fo=json`;
  const data = await fetchJSON(url);
  const item = data.item || {};
  const resources = data.resources || [];
  const images = [];
  for (const r of resources) {
    if (r.image) images.push(r.image);
    if (Array.isArray(r.files)) {
      for (const fileSet of r.files) {
        for (const f of fileSet) {
          if (f.mimetype?.startsWith("image/") && f.url) images.push(f.url);
        }
      }
    }
  }
  return {
    source: "loc",
    id: item.id,
    title: item.title,
    date: item.date,
    description: item.description,
    creator: item.creator,
    rights: item.rights,
    images: [...new Set(images)].slice(0, 20),
  };
}

// =========================================================================
// RIJKSMUSEUM (needs RIJKSMUSEUM_API_KEY)
// =========================================================================

const RIJKS_BASE = "https://www.rijksmuseum.nl/api/en";
const RIJKS_SIGNUP = "https://data.rijksmuseum.nl/object-metadata/api/";

async function rijksSearch({ query, pageSize = 10, imgOnly = true }) {
  const key = requireKey("RIJKSMUSEUM_API_KEY", RIJKS_SIGNUP);
  const params = new URLSearchParams({
    key,
    q: query,
    ps: String(pageSize),
    imgonly: String(imgOnly),
  });
  const data = await fetchJSON(`${RIJKS_BASE}/collection?${params.toString()}`);
  return {
    source: "rijksmuseum",
    totalResults: data.count,
    showing: (data.artObjects || []).length,
    results: (data.artObjects || []).map((o) => ({
      objectNumber: o.objectNumber,
      title: o.title,
      principalOrFirstMaker: o.principalOrFirstMaker,
      longTitle: o.longTitle,
      webImage: o.webImage?.url,
      headerImage: o.headerImage?.url,
      productionPlaces: o.productionPlaces,
    })),
  };
}

async function rijksGetObject({ objectNumber }) {
  const key = requireKey("RIJKSMUSEUM_API_KEY", RIJKS_SIGNUP);
  const data = await fetchJSON(`${RIJKS_BASE}/collection/${encodeURIComponent(objectNumber)}?key=${key}`);
  const o = data.artObject || {};
  return {
    source: "rijksmuseum",
    objectNumber: o.objectNumber,
    title: o.title,
    description: o.description || o.label?.description,
    principalMakers: o.principalMakers,
    dating: o.dating?.presentingDate,
    materials: o.materials,
    techniques: o.techniques,
    dimensions: o.subTitle,
    webImage: o.webImage?.url,
    classification: o.classification,
  };
}

// =========================================================================
// SMITHSONIAN OPEN ACCESS (needs SMITHSONIAN_API_KEY from data.gov)
// =========================================================================

const SI_BASE = "https://api.si.edu/openaccess/api/v1.0";
const SI_SIGNUP = "https://api.data.gov/signup/";

async function smithsonianSearch({ query, pageSize = 10, onlyCC0 = true }) {
  const key = requireKey("SMITHSONIAN_API_KEY", SI_SIGNUP);
  const q = onlyCC0 ? `(${query}) AND online_media_type:"Images" AND media_usage:"CC0"` : `(${query}) AND online_media_type:"Images"`;
  const params = new URLSearchParams({ api_key: key, q, rows: String(pageSize) });
  const data = await fetchJSON(`${SI_BASE}/search?${params.toString()}`);
  const rows = data.response?.rows || [];
  return {
    source: "smithsonian",
    totalResults: data.response?.rowCount || 0,
    showing: rows.length,
    results: rows.map((r) => {
      const dm = r.content?.descriptiveNonRepeating || {};
      const media = dm.online_media?.media?.[0] || {};
      return {
        id: r.id,
        title: r.title,
        unit: dm.unit_code,
        recordUrl: dm.record_link,
        thumbnail: media.thumbnail,
        fullImage: media.content,
        mediaType: media.type,
        usage: media.usage?.access,
      };
    }),
  };
}

async function smithsonianGetObject({ id }) {
  const key = requireKey("SMITHSONIAN_API_KEY", SI_SIGNUP);
  const data = await fetchJSON(`${SI_BASE}/content/${encodeURIComponent(id)}?api_key=${key}`);
  const r = data.response || {};
  const dm = r.content?.descriptiveNonRepeating || {};
  const indexed = r.content?.indexedStructured || {};
  return {
    source: "smithsonian",
    id: r.id,
    title: r.title,
    unit: dm.unit_code,
    recordUrl: dm.record_link,
    images: (dm.online_media?.media || []).map((m) => ({
      thumbnail: m.thumbnail,
      content: m.content,
      type: m.type,
      usage: m.usage?.access,
    })),
    date: indexed.date,
    place: indexed.place,
    objectType: indexed.object_type,
    topic: indexed.topic,
  };
}

// =========================================================================
// EUROPEANA (needs EUROPEANA_API_KEY; aggregates British Library + 50+ EU)
// =========================================================================

const EUROPEANA_BASE = "https://api.europeana.eu/record/v2";
const EUROPEANA_SIGNUP = "https://pro.europeana.eu/page/get-api";

async function europeanaSearch({ query, pageSize = 10, onlyOpen = true, provider }) {
  const wskey = requireKey("EUROPEANA_API_KEY", EUROPEANA_SIGNUP);
  const params = new URLSearchParams({
    wskey,
    query,
    rows: String(pageSize),
    profile: "rich",
    media: "true",
  });
  // Restrict to truly open licenses by default
  if (onlyOpen) params.append("reusability", "open");
  if (provider) params.append("qf", `PROVIDER:"${provider}"`);
  const data = await fetchJSON(`${EUROPEANA_BASE}/search.json?${params.toString()}`);
  const items = data.items || [];
  return {
    source: "europeana",
    totalResults: data.totalResults || 0,
    showing: items.length,
    results: items.map((i) => ({
      id: i.id,
      title: i.title?.[0],
      dataProvider: i.dataProvider?.[0],
      provider: i.provider?.[0],
      country: i.country?.[0],
      year: i.year?.[0],
      thumbnail: i.edmPreview?.[0],
      fullImage: i.edmIsShownBy?.[0],
      landingPage: i.edmIsShownAt?.[0] || `https://europeana.eu/item${i.id}`,
      rights: i.rights?.[0],
    })),
  };
}

async function europeanaGetRecord({ recordId }) {
  const wskey = requireKey("EUROPEANA_API_KEY", EUROPEANA_SIGNUP);
  // recordId looks like "/2048128/618580" — strip leading slash if present
  const id = recordId.startsWith("/") ? recordId.slice(1) : recordId;
  const data = await fetchJSON(`${EUROPEANA_BASE}/${id}.json?wskey=${wskey}`);
  const o = data.object || {};
  const aggregations = o.aggregations?.[0] || {};
  return {
    source: "europeana",
    id: o.about,
    title: o.title?.[0],
    description: o.proxies?.[0]?.dcDescription?.def?.[0],
    creator: o.proxies?.[0]?.dcCreator?.def?.[0],
    date: o.proxies?.[0]?.dcDate?.def?.[0],
    dataProvider: aggregations.edmDataProvider?.def?.[0],
    provider: aggregations.edmProvider?.def?.[0],
    rights: aggregations.edmRights?.def?.[0],
    fullImage: aggregations.edmIsShownBy,
    thumbnail: aggregations.edmPreview,
    landingPage: aggregations.edmIsShownAt,
  };
}

// =========================================================================
// SHARED — download
// =========================================================================

async function downloadImage({ url, savePath }) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(savePath), { recursive: true });
  await writeFile(savePath, buffer);
  return { savedTo: savePath, bytes: buffer.length, contentType: res.headers.get("content-type") };
}

// =========================================================================
// MCP server wiring
// =========================================================================

const TOOLS = [
  // ---- Wellcome ----
  {
    name: "wellcome_search",
    description: "Search the Wellcome Collection catalogue (UK). kind='works' for catalogue entries, kind='images' for direct IIIF image hits. Rich in medical/scientific/esoteric/astrological history; mostly CC-BY or Public Domain Mark. No API key.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query, e.g. 'jyotish', 'yantra', 'anatomy'" },
        kind: { type: "string", enum: ["works", "images"], default: "works" },
        pageSize: { type: "number", default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "wellcome_get_work",
    description: "Fetch a Wellcome work by ID with all associated IIIF image URLs.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "wellcome_image_url",
    description: "Build a direct Wellcome IIIF image URL at any IIIF Image API size ('1200,', ',900', 'full', etc.).",
    inputSchema: {
      type: "object",
      properties: {
        iiifId: { type: "string" },
        size: { type: "string", default: "1200," },
      },
      required: ["iiifId"],
    },
  },
  // ---- Met ----
  {
    name: "met_search",
    description: "Search the Met Museum (US). Defaults filter to hasImages + isPublicDomain (CC0), so every result is freely usable. 470k+ objects; narrow queries help. No API key.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        hasImages: { type: "boolean", default: true },
        isPublicDomain: { type: "boolean", default: true },
        departmentId: { type: "number", description: "Optional. 16 = Asian Art, 11 = European Paintings, etc." },
        pageSize: { type: "number", default: 20 },
      },
      required: ["query"],
    },
  },
  {
    name: "met_get_object",
    description: "Fetch a Met object by numeric ID with all image URLs (primary + additionals) and metadata.",
    inputSchema: { type: "object", properties: { objectId: { type: "number" } }, required: ["objectId"] },
  },
  // ---- LoC ----
  {
    name: "loc_search",
    description: "Search the Library of Congress (US). Massive collection across photos, manuscripts, prints, maps, newspapers, films. No API key. Use the category param to restrict (e.g. 'photos', 'maps', 'manuscripts').",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        category: { type: "string", description: "Optional: 'photos', 'maps', 'manuscripts', 'newspapers', 'film-and-videos', etc." },
        pageSize: { type: "number", default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "loc_get_item",
    description: "Fetch a Library of Congress item by full URL (e.g. 'https://www.loc.gov/item/2003663891/'). Returns metadata and all image file URLs.",
    inputSchema: { type: "object", properties: { itemUrl: { type: "string" } }, required: ["itemUrl"] },
  },
  // ---- Rijksmuseum ----
  {
    name: "rijks_search",
    description: "Search the Rijksmuseum (NL). All collection items post-1900 are Public Domain. Requires RIJKSMUSEUM_API_KEY env var (free, sign up at data.rijksmuseum.nl).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        pageSize: { type: "number", default: 10 },
        imgOnly: { type: "boolean", default: true },
      },
      required: ["query"],
    },
  },
  {
    name: "rijks_get_object",
    description: "Fetch a Rijksmuseum object by objectNumber (e.g. 'SK-C-5' = The Night Watch). Requires RIJKSMUSEUM_API_KEY.",
    inputSchema: { type: "object", properties: { objectNumber: { type: "string" } }, required: ["objectNumber"] },
  },
  // ---- Smithsonian ----
  {
    name: "smithsonian_search",
    description: "Search the Smithsonian Open Access (US). 4.5M+ items, defaults to CC0-only images. Requires SMITHSONIAN_API_KEY env var (free, sign up at api.data.gov).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        pageSize: { type: "number", default: 10 },
        onlyCC0: { type: "boolean", default: true },
      },
      required: ["query"],
    },
  },
  {
    name: "smithsonian_get_object",
    description: "Fetch a Smithsonian object by ID with all image URLs and metadata.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  // ---- Europeana ----
  {
    name: "europeana_search",
    description: "Search Europeana (EU aggregator covering British Library, Rijksmuseum, Louvre, and 4000+ other institutions). Defaults to open-licensed media only. Requires EUROPEANA_API_KEY env var (free, sign up at pro.europeana.eu).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        pageSize: { type: "number", default: 10 },
        onlyOpen: { type: "boolean", default: true, description: "Restrict to truly open licenses (CC0, CC-BY, PD)." },
        provider: { type: "string", description: "Optional. e.g. 'The British Library', 'Rijksmuseum'." },
      },
      required: ["query"],
    },
  },
  {
    name: "europeana_get_record",
    description: "Fetch a Europeana record by ID (e.g. '/2048128/618580'). Requires EUROPEANA_API_KEY.",
    inputSchema: { type: "object", properties: { recordId: { type: "string" } }, required: ["recordId"] },
  },
  // ---- Shared ----
  {
    name: "download_image",
    description: "Download any image URL to a local file path. Parent directories are created automatically. Works with images returned from any of the above sources.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        savePath: { type: "string", description: "Absolute local path, e.g. 'C:/path/to/project/public/brand/asset.jpg'" },
      },
      required: ["url", "savePath"],
    },
  },
];

const HANDLERS = {
  wellcome_search: wellcomeSearch,
  wellcome_get_work: wellcomeGetWork,
  wellcome_image_url: wellcomeImageURL,
  met_search: metSearch,
  met_get_object: metGetObject,
  loc_search: locSearch,
  loc_get_item: locGetItem,
  rijks_search: rijksSearch,
  rijks_get_object: rijksGetObject,
  smithsonian_search: smithsonianSearch,
  smithsonian_get_object: smithsonianGetObject,
  europeana_search: europeanaSearch,
  europeana_get_record: europeanaGetRecord,
  download_image: downloadImage,
};

const server = new Server(
  { name: "archival-imagery", version: "0.2.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const handler = HANDLERS[name];
  if (!handler) {
    return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  }
  try {
    const result = await handler(args || {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error in ${name}: ${err?.message || String(err)}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("archival-imagery-mcp v0.2 ready on stdio");
