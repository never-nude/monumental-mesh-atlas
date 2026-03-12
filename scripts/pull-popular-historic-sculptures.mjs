#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP_DIR = path.resolve(ROOT, "stl-catalog");
const OUTPUT_JSON = path.resolve(APP_DIR, "data", "popular-sculptures-renaissance-19c.json");
const OUTPUT_CSV = path.resolve(APP_DIR, "data", "popular-sculptures-renaissance-19c.csv");

const args = parseArgs(process.argv.slice(2));
const limit = toPositiveInt(args.limit, 200);
const pagesPerQuery = toPositiveInt(args.pages, 5);
const minFaces = toPositiveInt(args.minFaces, 1500);
const delayMs = toPositiveInt(args.delayMs, 140);
const sortBy = args.sortBy || "-likeCount";
const strictContext = args.strictContext !== "false";
const verbose = args.verbose === "true" || args.verbose === "1";

const QUERIES = [
  "michelangelo sculpture",
  "david michelangelo sculpture",
  "pieta michelangelo sculpture",
  "moses michelangelo sculpture",
  "donatello sculpture",
  "bernini sculpture",
  "apollo and daphne bernini",
  "ecstasy of saint teresa bernini",
  "cellini sculpture",
  "perseus benvenuto cellini",
  "giambologna sculpture",
  "rape of the sabine women sculpture",
  "verrocchio sculpture",
  "ghiberti sculpture",
  "gattamelata donatello",
  "canova sculpture",
  "thorvaldsen sculpture",
  "houdon sculpture",
  "rodin sculpture",
  "thinker rodin",
  "the kiss rodin",
  "burghers of calais rodin",
  "gates of hell rodin",
  "carpeaux sculpture",
  "francois rude sculpture",
  "antoine louis barye sculpture",
  "bartolini sculpture",
  "falconet sculpture",
  "pigalle sculpture",
  "clodion sculpture",
  "hiram powers sculpture",
  "saint gaudens sculpture",
  "renaissance sculpture marble",
  "baroque sculpture marble",
  "neoclassical sculpture marble",
  "19th century sculpture marble",
  "romantic sculpture 19th century",
  "academic sculpture 19th century",
  "museum plaster cast sculpture",
  "cultural heritage sculpture scan",
  "museum sculpture scan marble",
  "heritage statue scan",
  "historical sculpture bust",
  "renaissance marble bust",
  "baroque marble bust",
  "neoclassical marble statue",
  "beaux arts sculpture",
  "victorian sculpture statue",
  "public monument 19th century sculpture",
  "european sculpture 1800s",
  "french sculpture 19th century",
  "italian sculpture renaissance",
  "florence sculpture renaissance",
  "rome baroque sculpture",
  "vatican sculpture scan",
  "plaster cast sculpture museum",
  "bronze bust 19th century",
  "marble monument statue 1800",
  "historic saint statue sculpture",
  "renaissance bust sculpture museum",
  "baroque bust sculpture museum",
  "neoclassical bust sculpture museum",
  "19th century bust sculpture museum",
  "renaissance statue scan",
  "baroque statue scan",
  "neoclassical statue scan",
  "victorian statue scan",
  "beaux arts statue scan",
  "italian renaissance bust",
  "french neoclassical sculpture",
  "french romantic sculpture",
  "english 19th century sculpture",
  "german 19th century sculpture",
  "spanish 19th century sculpture",
  "belgian 19th century sculpture",
  "austrian 19th century sculpture",
  "church sculpture renaissance scan",
  "cathedral sculpture baroque scan",
  "public square statue 1800s",
  "museum marble statue 1700",
  "museum bronze bust 1800",
  "jules dalou sculpture",
  "edmonia lewis sculpture",
  "bartholdi sculpture",
  "camille claudel sculpture",
  "lorado taft sculpture",
  "medardo rosso sculpture",
  "francois rude relief sculpture",
  "antoine louis barye animalier",
  "antonio corradini sculpture",
  "pietro tacca sculpture",
  "alessandro algardi sculpture",
  "jacopo sansovino sculpture",
  "luca della robbia sculpture",
  "andrea della robbia sculpture",
  "mannerist sculpture giambologna",
  "rodin bust sculpture",
  "canova bust sculpture",
  "thorvaldsen bust sculpture"
];

const ARTIST_KEYWORDS = [
  "michelangelo",
  "donatello",
  "bernini",
  "cellini",
  "giambologna",
  "verrocchio",
  "ghiberti",
  "canova",
  "thorvaldsen",
  "houdon",
  "rodin",
  "carpeaux",
  "rude",
  "barye",
  "bartolini",
  "falconet",
  "pigalle",
  "clodion",
  "hiram powers",
  "saint-gaudens",
  "saint gaudens",
  "camille claudel",
  "medardo rosso",
  "bartholdi",
  "jules dalou",
  "edmonia lewis",
  "lorado taft",
  "antonio corradini",
  "pietro tacca",
  "algardi",
  "sansovino",
  "luca della robbia",
  "andrea della robbia"
];

const PERIOD_KEYWORDS = [
  "renaissance",
  "baroque",
  "neoclassical",
  "neoclassic",
  "romanticism",
  "romantic",
  "nineteenth century",
  "19th century",
  "18th century",
  "17th century",
  "16th century",
  "15th century",
  "xix",
  "xviii",
  "xvii",
  "xvi",
  "xv"
];

const WORK_KEYWORDS = [
  "david",
  "pieta",
  "moses",
  "thinker",
  "the kiss",
  "burghers of calais",
  "gates of hell",
  "perseus",
  "gattamelata",
  "apollo and daphne",
  "ecstasy of saint teresa",
  "sabine",
  "ugolino",
  "balzac",
  "dying slave",
  "rebellious slave"
];

const SCULPTURE_KEYWORDS = [
  "sculpture",
  "statue",
  "bust",
  "monument",
  "marble",
  "bronze",
  "bas relief",
  "relief",
  "cultural heritage",
  "museum"
];

const PRE_RENAISSANCE_BLOCKLIST = [
  "laocoon",
  "venus de milo",
  "hellenistic",
  "ancient greek",
  "classical greek",
  "ancient roman",
  "roman empire",
  "egyptian",
  "mesopotamian",
  "assyrian",
  "bce",
  "100 bc",
  "200 bc"
];

const TOPICAL_BLOCKLIST = [
  "anime",
  "pokemon",
  "warhammer",
  "dnd",
  "fortnite",
  "fanart",
  "miniature",
  "stylized",
  "lowpoly",
  "low poly",
  "weapon",
  "gun",
  "vehicle",
  "car",
  "house",
  "furniture",
  "game asset",
  "avatar",
  "character",
  "retopo",
  "remix",
  "remixed",
  "hyperobject",
  "futuristic",
  "thumbs up",
  "frog sculpture",
  "ai generated",
  "generator",
  "kitbash",
  "fan made"
];

const querySet = Array.from(new Set(QUERIES.map((query) => query.trim()).filter(Boolean)));

const stats = {
  queryCount: querySet.length,
  pagesPerQuery,
  rawHits: 0,
  keptHits: 0,
  duplicateHits: 0,
  rejectedHits: 0
};

const byUid = new Map();

for (const query of querySet) {
  if (verbose) {
    console.log(`Query: ${query}`);
  }

  let nextUrl = buildSearchUrl(query, sortBy);

  for (let page = 0; page < pagesPerQuery; page += 1) {
    if (!nextUrl) {
      break;
    }

    const response = await fetchJsonWithRetry(nextUrl);
    const results = Array.isArray(response.results) ? response.results : [];
    stats.rawHits += results.length;

    for (const result of results) {
      const screened = screenResult(result, { minFaces, query, strictContext });
      if (!screened.ok) {
        stats.rejectedHits += 1;
        continue;
      }

      const existing = byUid.get(screened.item.uid);
      if (!existing) {
        byUid.set(screened.item.uid, {
          ...screened.item,
          matchedQueries: [query]
        });
        stats.keptHits += 1;
        continue;
      }

      stats.duplicateHits += 1;

      existing.matchedQueries.push(query);
      existing.matchedQueries = Array.from(new Set(existing.matchedQueries));

      if (screened.item.popularityScore > existing.popularityScore) {
        byUid.set(screened.item.uid, {
          ...screened.item,
          matchedQueries: existing.matchedQueries
        });
      }
    }

    nextUrl = response.next || null;
    if (nextUrl && delayMs > 0) {
      await sleep(delayMs);
    }
  }
}

const allItems = Array.from(byUid.values()).sort((a, b) => b.popularityScore - a.popularityScore);
const selected = allItems.slice(0, limit);

const manifest = {
  name: "Popular Sculptures (Renaissance to 19th Century)",
  source: "Sketchfab Data API v3 search",
  generatedAt: new Date().toISOString(),
  queryStrategy: {
    sortBy,
    minFaces,
    strictContext,
    pagesPerQuery,
    queryCount: querySet.length
  },
  stats: {
    ...stats,
    uniqueCandidates: allItems.length,
    selectedCount: selected.length,
    requestedLimit: limit
  },
  items: selected
};

fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
fs.writeFileSync(OUTPUT_CSV, toCsv(selected), "utf8");

console.log(`Wrote ${selected.length} items to ${OUTPUT_JSON}`);
console.log(`CSV export: ${OUTPUT_CSV}`);
console.log(`Unique candidates before cap: ${allItems.length}`);

function parseArgs(values) {
  const parsed = {};
  for (let i = 0; i < values.length; i += 1) {
    const token = values[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = values[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }

    parsed[key] = next;
    i += 1;
  }
  return parsed;
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

function buildSearchUrl(query, sortByValue) {
  const params = new URLSearchParams({
    type: "models",
    q: query,
    downloadable: "true",
    count: "24",
    sort_by: sortByValue
  });

  return `https://api.sketchfab.com/v3/search?${params.toString()}`;
}

async function fetchJsonWithRetry(url, maxAttempts = 4) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status} for ${url}: ${body.slice(0, 220)}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        break;
      }

      await sleep(250 * attempt);
    }
  }

  throw lastError;
}

function screenResult(result, { minFaces: faceThreshold, query, strictContext }) {
  if (!result || !result.uid || !result.isDownloadable) {
    return { ok: false, reason: "not_downloadable" };
  }

  if (result.isAgeRestricted) {
    return { ok: false, reason: "age_restricted" };
  }

  const coreText = buildCoreText(result);
  const tagText = buildTagText(result);
  const fullText = `${coreText} ${tagText}`.trim();

  if (!containsAny(fullText, SCULPTURE_KEYWORDS)) {
    return { ok: false, reason: "not_sculpture_like" };
  }

  const hasPrimaryContext =
    containsAny(coreText, [...ARTIST_KEYWORDS, ...PERIOD_KEYWORDS, ...WORK_KEYWORDS]) || hasCenturyToken(coreText);
  const hasSecondaryContext = containsAny(tagText, [...ARTIST_KEYWORDS, ...PERIOD_KEYWORDS, ...WORK_KEYWORDS]);
  const hasQueryContext = containsAny(String(query || "").toLowerCase(), [
    ...ARTIST_KEYWORDS,
    ...PERIOD_KEYWORDS,
    ...WORK_KEYWORDS
  ]);

  const hasContext = hasPrimaryContext || hasSecondaryContext || (!strictContext && hasQueryContext);
  if (!hasContext) {
    return { ok: false, reason: "no_period_or_artist_context" };
  }

  if (containsAny(fullText, PRE_RENAISSANCE_BLOCKLIST)) {
    return { ok: false, reason: "outside_target_period" };
  }

  if (containsAny(fullText, TOPICAL_BLOCKLIST)) {
    return { ok: false, reason: "off_topic" };
  }

  const archiveInfo = extractArchiveInfo(result.archives);
  const faceCount = Math.max(Number(result.faceCount || 0), archiveInfo.faceCount || 0);
  const vertexCount = Math.max(Number(result.vertexCount || 0), archiveInfo.vertexCount || 0);

  if (faceCount < faceThreshold) {
    return { ok: false, reason: "too_few_faces" };
  }

  if (archiveInfo.types.length === 0) {
    return { ok: false, reason: "no_mesh_archive" };
  }

  const likes = Number(result.likeCount || 0);
  const views = Number(result.viewCount || 0);
  if (likes < 1 && views < 25) {
    return { ok: false, reason: "low_popularity_floor" };
  }

  const item = {
    uid: result.uid,
    title: result.name || "Untitled",
    creator: result.user?.displayName || result.user?.username || null,
    viewerUrl: result.viewerUrl || null,
    apiUrl: result.uri || null,
    publishedAt: result.publishedAt || null,
    likeCount: Number(result.likeCount || 0),
    viewCount: Number(result.viewCount || 0),
    commentCount: Number(result.commentCount || 0),
    faceCount,
    vertexCount,
    archiveTypes: archiveInfo.types,
    estimatedPeriod: inferPeriod(fullText),
    estimatedArtist: inferArtist(fullText),
    tags: (result.tags || []).map((tag) => tag.name).filter(Boolean).slice(0, 14),
    categories: (result.categories || []).map((category) => category.name).filter(Boolean),
    license: result.license?.label || result.license?.fullName || result.license?.slug || null,
    popularityScore: calcPopularityScore(result, faceCount),
    description: sanitizeDescription(result.description)
  };

  return { ok: true, item };
}

function extractArchiveInfo(archives) {
  const candidates = archives && typeof archives === "object" ? archives : {};
  const meshTypes = ["glb", "gltf", "source", "usdz", "fbx", "obj", "stl", "ply"];

  const types = [];
  let faceCount = 0;
  let vertexCount = 0;

  for (const type of meshTypes) {
    const entry = candidates[type];
    if (!entry || typeof entry !== "object") {
      continue;
    }

    types.push(type);
    faceCount = Math.max(faceCount, Number(entry.faceCount || 0));
    vertexCount = Math.max(vertexCount, Number(entry.vertexCount || 0));
  }

  return { types, faceCount, vertexCount };
}

function calcPopularityScore(result, faceCount) {
  const likes = Number(result.likeCount || 0);
  const views = Number(result.viewCount || 0);
  const comments = Number(result.commentCount || 0);
  const staffpickedBonus = result.staffpickedAt ? 60 : 0;
  const topologyBonus = Math.log10(Math.max(faceCount, 1)) * 6;

  return likes * 8 + views * 0.08 + comments * 3 + staffpickedBonus + topologyBonus;
}

function buildCoreText(result) {
  return `${result.name || ""} ${result.description || ""}`.toLowerCase();
}

function buildTagText(result) {
  const tags = (result.tags || []).map((tag) => tag.name).join(" ");
  const categories = (result.categories || []).map((category) => category.name).join(" ");
  return `${tags} ${categories}`.toLowerCase();
}

function containsAny(text, tokens) {
  return tokens.some((token) => text.includes(token));
}

function hasCenturyToken(text) {
  return /(15th|16th|17th|18th|19th|xv|xvi|xvii|xviii|xix|1[5-9]00|1[5-9]0s)/.test(text);
}

function inferArtist(text) {
  for (const keyword of ARTIST_KEYWORDS) {
    if (text.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

function inferPeriod(text) {
  for (const keyword of PERIOD_KEYWORDS) {
    if (text.includes(keyword)) {
      return keyword;
    }
  }

  if (text.includes("15th") || text.includes("16th") || text.includes("xv") || text.includes("xvi")) {
    return "renaissance";
  }
  if (text.includes("17th") || text.includes("xvii")) {
    return "baroque";
  }
  if (text.includes("18th") || text.includes("xviii")) {
    return "18th century";
  }
  if (text.includes("19th") || text.includes("xix")) {
    return "19th century";
  }

  return null;
}

function sanitizeDescription(value) {
  if (!value) {
    return null;
  }

  const flattened = String(value).replace(/\s+/g, " ").trim();
  return flattened.length > 280 ? `${flattened.slice(0, 277)}...` : flattened;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toCsv(items) {
  const header = [
    "rank",
    "uid",
    "title",
    "creator",
    "estimatedArtist",
    "estimatedPeriod",
    "faceCount",
    "vertexCount",
    "likeCount",
    "viewCount",
    "commentCount",
    "archiveTypes",
    "viewerUrl",
    "publishedAt"
  ];

  const rows = [header.join(",")];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const row = [
      String(index + 1),
      item.uid,
      item.title,
      item.creator || "",
      item.estimatedArtist || "",
      item.estimatedPeriod || "",
      String(item.faceCount || 0),
      String(item.vertexCount || 0),
      String(item.likeCount || 0),
      String(item.viewCount || 0),
      String(item.commentCount || 0),
      (item.archiveTypes || []).join("|"),
      item.viewerUrl || "",
      item.publishedAt || ""
    ].map(csvEscape);

    rows.push(row.join(","));
  }

  return `${rows.join("\n")}\n`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}
