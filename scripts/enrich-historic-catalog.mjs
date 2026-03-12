#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP_DIR = path.resolve(ROOT, "stl-catalog");
const DEFAULT_INPUT = path.resolve(APP_DIR, "data", "popular-sculptures-renaissance-19c.json");
const DEFAULT_OUTPUT = DEFAULT_INPUT;

const args = parseArgs(process.argv.slice(2));
const inputFile = args.input ? path.resolve(process.cwd(), args.input) : DEFAULT_INPUT;
const outputFile = args.output ? path.resolve(process.cwd(), args.output) : DEFAULT_OUTPUT;
const concurrency = toPositiveInt(args.concurrency, 4);
const delayMs = toPositiveInt(args.delayMs, 100);
const maxItems = toPositiveInt(args.limit, Number.POSITIVE_INFINITY);

const manifest = readJson(inputFile);
const sourceItems = Array.isArray(manifest.items) ? manifest.items : [];
const targetItems = sourceItems.slice(0, Math.min(sourceItems.length, maxItems));
const untouchedTail = sourceItems.slice(targetItems.length);

const stats = {
  total: sourceItems.length,
  targeted: targetItems.length,
  enriched: 0,
  failed: 0
};

const queue = targetItems.map((item, index) => ({ item, index }));
let cursor = 0;
const failures = [];

await Promise.all(
  Array.from({ length: concurrency }, () =>
    (async function worker() {
      while (true) {
        const nextIndex = cursor;
        cursor += 1;
        if (nextIndex >= queue.length) {
          return;
        }

        const { item, index } = queue[nextIndex];
        try {
          const hydrated = await hydrateItem(item);
          targetItems[index] = hydrated;
          stats.enriched += 1;
        } catch (error) {
          stats.failed += 1;
          failures.push({
            uid: item.uid || null,
            title: item.title || null,
            error: error.message
          });
        }

        if (delayMs > 0) {
          await sleep(delayMs);
        }
      }
    })()
  )
);

const nextManifest = {
  ...manifest,
  enrichedAt: new Date().toISOString(),
  enrichmentStrategy: {
    source: "https://api.sketchfab.com/v3/models/{uid}",
    concurrency,
    delayMs,
    targeted: stats.targeted
  },
  items: [...targetItems, ...untouchedTail]
};

fs.writeFileSync(outputFile, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");

console.log(`Historic catalog enriched: ${outputFile}`);
console.log(`Total items: ${stats.total}`);
console.log(`Targeted: ${stats.targeted}`);
console.log(`Enriched: ${stats.enriched}`);
console.log(`Failed: ${stats.failed}`);

if (failures.length > 0) {
  const preview = failures
    .slice(0, 10)
    .map((entry) => `${entry.uid || "unknown"} (${entry.title || "Untitled"}): ${entry.error}`)
    .join("\n");
  console.log("\nFailed samples:");
  console.log(preview);
}

async function hydrateItem(item) {
  if (!item?.uid) {
    return item;
  }

  const details = await fetchJsonWithRetry(`https://api.sketchfab.com/v3/models/${encodeURIComponent(item.uid)}`);
  const thumbnail = pickThumbnail(details.thumbnails);
  const tags = (details.tags || []).map((tag) => tag.name).filter(Boolean).slice(0, 18);
  const categories = (details.categories || []).map((category) => category.name).filter(Boolean);

  return {
    ...item,
    title: details.name || item.title || "Untitled",
    creator: details.user?.displayName || details.user?.username || item.creator || null,
    viewerUrl: details.viewerUrl || item.viewerUrl || null,
    embedUrl: details.embedUrl || item.embedUrl || null,
    apiUrl: details.uri || item.apiUrl || null,
    publishedAt: details.publishedAt || item.publishedAt || null,
    likeCount: toNumber(details.likeCount, item.likeCount),
    viewCount: toNumber(details.viewCount, item.viewCount),
    commentCount: toNumber(details.commentCount, item.commentCount),
    faceCount: toMaxNumber(details.faceCount, item.faceCount),
    vertexCount: toMaxNumber(details.vertexCount, item.vertexCount),
    tags: tags.length ? tags : item.tags || [],
    categories: categories.length ? categories : item.categories || [],
    license:
      details.license?.label || details.license?.fullName || details.license?.slug || item.license || null,
    isDownloadable: details.isDownloadable ?? item.isDownloadable ?? true,
    thumbnailUrl: thumbnail?.url || item.thumbnailUrl || null,
    thumbnailWidth: thumbnail?.width || item.thumbnailWidth || null,
    thumbnailHeight: thumbnail?.height || item.thumbnailHeight || null,
    description: sanitizeDescription(details.description || item.description)
  };
}

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

function toNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return Number(fallback || 0);
  }
  return n;
}

function toMaxNumber(primary, secondary) {
  return Math.max(toNumber(primary, 0), toNumber(secondary, 0));
}

function pickThumbnail(thumbnails) {
  const images = Array.isArray(thumbnails?.images) ? thumbnails.images : [];
  if (!images.length) {
    return null;
  }

  const sorted = images
    .filter((image) => image && image.url && Number(image.width || 0) > 0)
    .sort((a, b) => Number(b.width || 0) - Number(a.width || 0));

  if (!sorted.length) {
    return null;
  }

  return sorted.find((image) => Number(image.width || 0) >= 512) || sorted[0];
}

function sanitizeDescription(value) {
  if (!value) {
    return null;
  }

  const flattened = String(value).replace(/\s+/g, " ").trim();
  return flattened.length > 300 ? `${flattened.slice(0, 297)}...` : flattened;
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
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
