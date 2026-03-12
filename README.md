# Monumental Mesh Atlas

A standalone web app for browsing STL-style sculpture renderings with triangle-heavy meshes, plus optional node and edge overlays.

## Why this is built for large meshes

- Triangle-first renderer: surfaces are the primary layer, with node and edge overlays as optional toggles.
- Worker preprocessing: model parsing and sampling happen in `model-worker.js` off the main thread.
- Adaptive budgets: quality profiles cap rendered triangles, nodes, and edge segments so very large datasets stay interactive.
- Virtualized catalog list: only visible cards are rendered in the sidebar for large collections.

## Run locally

Use a static server from the `stl-catalog` directory:

```bash
cd "/Users/michael/Documents/New project/stl-catalog"
python3 -m http.server 8074
```

Open:

- [http://localhost:8074/](http://localhost:8074/)

## Rebuild catalog manifest

```bash
cd "/Users/michael/Documents/New project"
node ./stl-catalog/scripts/generate-catalog.mjs
```

This rewrites `stl-catalog/data/catalog.json` using current mesh metadata.

## Pull 200 popular historic sculpture candidates

```bash
cd "/Users/michael/Documents/New project"
node ./stl-catalog/scripts/pull-popular-historic-sculptures.mjs --limit 200 --pages 4 --minFaces 1500
```

Outputs:

- `stl-catalog/data/popular-sculptures-renaissance-19c.json`
- `stl-catalog/data/popular-sculptures-renaissance-19c.csv`

Notes:

- Data source is Sketchfab search metadata for downloadable models.
- This step pulls ranked metadata and archive availability, not binary mesh files.
- Authenticated download endpoints can be added in a follow-up step when a Sketchfab token is available.

## Add a new sculpture dataset

1. Add a model JSON file using either format:
   - Triangle mesh: `positions` + `indices`
   - Node/face graph: `vertices`/`nodes`, optional `faces`, optional `edges`
2. Add a new source entry in `stl-catalog/scripts/generate-catalog.mjs` (or edit `stl-catalog/data/catalog.json` directly).
3. Refresh the app.

## Quality profiles

- `Auto`: picks profile by source triangle density.
- `Cinematic`: highest budgets; best visuals, most GPU load.
- `Gallery`: high fidelity, reduced edge density.
- `Balanced`: default for large meshes.
- `Performance`: aggressive decimation for very dense assets.
