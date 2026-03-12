#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP_DIR = path.resolve(ROOT, "stl-catalog");
const OUTPUT_FILE = path.resolve(APP_DIR, "data", "catalog.json");

const SOURCES = [
  {
    id: "david-study",
    title: "David Study",
    artist: "Michelangelo",
    year: "1501-1504",
    origin: "Florence",
    style: "Renaissance",
    description:
      "High-density study mesh from Michelangelo's David, configured for triangle-forward rendering with node overlays.",
    tags: ["marble", "heroic nude", "stl-style"],
    dataPath: path.resolve(ROOT, "DavidStudy", "david_study_mesh.json"),
    dataUrl: "./data/models/david_study_mesh.json",
    format: "tri_mesh",
    palette: {
      background: "#0a1417",
      surface: "#d7ccb8",
      edge: "#84c6c0",
      node: "#efb57f"
    }
  },
  {
    id: "cupid-bouchardon",
    title: "Cupid Cutting His Bow",
    artist: "Edme Bouchardon",
    year: "c. 1745",
    origin: "French school",
    style: "Rococo",
    description:
      "Detailed surface extraction of Bouchardon's Cupid, showing a dense triangle field and marble-point cloud structure.",
    tags: ["rococo", "mythology", "stl-style"],
    dataPath: path.resolve(ROOT, "BouchardonCupid", "cupid_mesh.json"),
    dataUrl: "./data/models/cupid_mesh.json",
    format: "tri_mesh",
    palette: {
      background: "#0e1518",
      surface: "#d9d0be",
      edge: "#89d4cb",
      node: "#f2bb8c"
    }
  },
  {
    id: "pieta-wireframe",
    title: "Pieta Wireframe Study",
    artist: "Michelangelo",
    year: "1498-1499",
    origin: "Vatican Pieta",
    style: "High Renaissance",
    description:
      "Hybrid node-edge sculpture map with sampled faces, suitable for testing large graph overlays on top of triangle structure.",
    tags: ["pieta", "node graph", "stl-style"],
    dataPath: path.resolve(ROOT, "Pieta", "pieta_wireframe.json"),
    dataUrl: "./data/models/pieta_wireframe.json",
    format: "node_face",
    palette: {
      background: "#0d1218",
      surface: "#d5c8b2",
      edge: "#73b7d2",
      node: "#f0ad79"
    }
  }
];

const items = SOURCES.map((source) => {
  const payload = readJson(source.dataPath);
  const meta = payload.meta || {};

  const triangleCount = Number(meta.faces || countTriangles(payload));
  const nodeCount = Number(meta.nodes || countNodes(payload));
  const edgeCount = Number(meta.edges || countEdges(payload, triangleCount));
  const sourceTriangleCount = Number(meta.source_triangles || triangleCount);

  return {
    id: source.id,
    title: source.title,
    artist: source.artist,
    year: source.year,
    origin: source.origin,
    style: source.style,
    description: source.description,
    tags: source.tags,
    dataUrl: source.dataUrl,
    format: source.format,
    nodeCount,
    triangleCount,
    edgeCount,
    sourceTriangleCount,
    palette: source.palette
  };
});

const manifest = {
  name: "Monumental Mesh Atlas",
  version: 1,
  generatedAt: new Date().toISOString().slice(0, 10),
  items
};

fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Catalog written to ${OUTPUT_FILE}`);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function countTriangles(payload) {
  if (Array.isArray(payload.indices)) {
    return Math.floor(payload.indices.length / 3);
  }
  if (Array.isArray(payload.faces)) {
    return payload.faces.length;
  }
  return 0;
}

function countNodes(payload) {
  if (Array.isArray(payload.positions)) {
    return Math.floor(payload.positions.length / 3);
  }
  if (Array.isArray(payload.nodes)) {
    return payload.nodes.length;
  }
  if (Array.isArray(payload.vertices)) {
    return payload.vertices.length;
  }
  return 0;
}

function countEdges(payload, triangleCount) {
  if (Array.isArray(payload.edges)) {
    return payload.edges.length;
  }
  return triangleCount * 3;
}
