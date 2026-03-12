import * as THREE from "./vendor/three/build/three.module.js";
import { OrbitControls } from "./vendor/three/examples/jsm/controls/OrbitControls.js";

const CATALOG_URL = "./data/catalog.json";
const HISTORIC_CATALOG_URL = "./data/popular-sculptures-renaissance-19c.json";
const ROW_HEIGHT = 132;
const OVERSCAN = 6;
const NUMBER = new Intl.NumberFormat("en-US");

const dom = {
  statTotalWorks: getById("statTotalWorks"),
  statTotalNodes: getById("statTotalNodes"),
  statTotalTriangles: getById("statTotalTriangles"),
  collectionSelect: getById("collectionSelect"),
  searchInput: getById("searchInput"),
  workSelect: getById("workSelect"),
  loadMoreWorksBtn: getById("loadMoreWorksBtn"),
  workBatchStatus: getById("workBatchStatus"),
  styleFilter: getById("styleFilter"),
  sortSelect: getById("sortSelect"),
  resultsCount: getById("resultsCount"),
  catalogScroll: getById("catalogScroll"),
  catalogSpacer: getById("catalogSpacer"),
  catalogItems: getById("catalogItems"),
  viewerCanvas: getById("viewerCanvas"),
  viewerMessage: getById("viewerMessage"),
  qualitySelect: getById("qualitySelect"),
  nodeSize: getById("nodeSize"),
  toggleNodes: getById("toggleNodes"),
  toggleEdges: getById("toggleEdges"),
  toggleSurface: getById("toggleSurface"),
  toggleRotate: getById("toggleRotate"),
  recenterBtn: getById("recenterBtn"),
  detailsPanel: getById("detailsPanel")
};

const state = {
  catalog: [],
  filtered: [],
  byId: new Map(),
  activeId: null,
  scope: "all",
  search: "",
  style: "all",
  sort: dom.sortSelect.value,
  quality: dom.qualitySelect.value,
  layers: {
    nodes: dom.toggleNodes.checked,
    edges: dom.toggleEdges.checked,
    surface: dom.toggleSurface.checked,
    autoRotate: dom.toggleRotate.checked
  },
  nodeSize: Number(dom.nodeSize.value),
  batchSize: 4,
  localTotal: 0,
  historicTotal: 0,
  historicQueue: []
};

const viewer = new AtlasViewer({
  canvas: dom.viewerCanvas,
  messageEl: dom.viewerMessage
});

bindEvents();

boot().catch((error) => {
  viewer.setMessage(`Failed to initialize catalog: ${error.message}`, true);
});

async function boot() {
  await viewer.init();
  const manifest = await loadCatalogs();
  state.localTotal = manifest.localItems.length;
  state.historicTotal = manifest.historicItems.length;

  const initialHistoric = manifest.historicItems.slice(0, state.batchSize);
  state.historicQueue = manifest.historicItems.slice(state.batchSize);

  state.catalog = [...manifest.localItems, ...initialHistoric];
  state.byId = new Map(state.catalog.map((item) => [item.id, item]));
  hydrateCollectionFilter({
    local: state.localTotal,
    historicLoaded: initialHistoric.length,
    historicTotal: state.historicTotal
  });
  updateWorkBatchStatus();

  updateTopStats();
  hydrateStyleFilter();
  applyFilters();
}

function bindEvents() {
  dom.collectionSelect.addEventListener("change", () => {
    state.scope = dom.collectionSelect.value;
    hydrateStyleFilter();
    updateTopStats();
    applyFilters();
  });

  const onSearchChange = () => {
    state.search = dom.searchInput.value.trim().toLowerCase();
    applyFilters();
  };
  dom.searchInput.addEventListener("input", onSearchChange);
  dom.searchInput.addEventListener("search", onSearchChange);
  dom.searchInput.addEventListener("change", onSearchChange);
  dom.searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    onSearchChange();

    if (state.filtered.length > 0) {
      void selectItem(state.filtered[0].id, { resetScroll: false });
    }
  });

  dom.workSelect.addEventListener("change", () => {
    const selectedId = dom.workSelect.value;
    if (!selectedId) {
      return;
    }
    void selectItem(selectedId, { resetScroll: false });
  });

  dom.loadMoreWorksBtn.addEventListener("click", () => {
    loadMoreHistoricBatch();
  });

  dom.styleFilter.addEventListener("change", () => {
    state.style = dom.styleFilter.value;
    applyFilters();
  });

  dom.sortSelect.addEventListener("change", () => {
    state.sort = dom.sortSelect.value;
    applyFilters();
  });

  dom.catalogScroll.addEventListener("scroll", renderCatalogWindow);
  window.addEventListener("resize", renderCatalogWindow);

  dom.catalogItems.addEventListener("click", (event) => {
    const card = event.target.closest(".catalog-card[data-model-id]");
    if (!card) {
      return;
    }
    void selectItem(card.dataset.modelId);
  });

  dom.qualitySelect.addEventListener("change", () => {
    state.quality = dom.qualitySelect.value;
    if (state.activeId) {
      void selectItem(state.activeId);
    }
  });

  dom.nodeSize.addEventListener("input", () => {
    state.nodeSize = Number(dom.nodeSize.value);
    viewer.setNodeSize(state.nodeSize);
  });

  dom.toggleNodes.addEventListener("change", () => {
    state.layers.nodes = dom.toggleNodes.checked;
    viewer.setLayerVisibility(state.layers);
  });

  dom.toggleEdges.addEventListener("change", () => {
    state.layers.edges = dom.toggleEdges.checked;
    viewer.setLayerVisibility(state.layers);
  });

  dom.toggleSurface.addEventListener("change", () => {
    state.layers.surface = dom.toggleSurface.checked;
    viewer.setLayerVisibility(state.layers);
  });

  dom.toggleRotate.addEventListener("change", () => {
    state.layers.autoRotate = dom.toggleRotate.checked;
    viewer.setAutoRotate(state.layers.autoRotate);
  });

  dom.recenterBtn.addEventListener("click", () => {
    viewer.recenter();
  });
}

async function loadCatalogs() {
  const [localManifest, historicManifest] = await Promise.all([
    fetchJson(CATALOG_URL),
    fetchJson(HISTORIC_CATALOG_URL)
  ]);

  const localItems = (localManifest.items || []).map((item) => normalizeLocalItem(item));
  const historicItems = (historicManifest.items || []).map((item) => normalizeHistoricItem(item));

  return {
    localItems,
    historicItems
  };
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url} (${response.status})`);
  }
  return response.json();
}

function normalizeLocalItem(item) {
  return {
    ...item,
    id: `local-${item.id}`,
    catalogType: "local",
    renderable: true
  };
}

function normalizeHistoricItem(item) {
  const style = formatHistoricStyle(item.estimatedPeriod);
  const creator = item.creator || null;
  const inferredArtist = formatHistoricArtist(item.estimatedArtist);
  const artist = inferredArtist || creator || "Unknown artist";

  return {
    id: `historic-${item.uid}`,
    title: item.title || "Untitled",
    artist,
    creator,
    year: inferCenturyLabel(item.estimatedPeriod),
    origin: creator ? `Sketchfab by ${creator}` : "Sketchfab source",
    style: style || "Historic catalog",
    description: item.description || "Historic sculpture listing with downloadable mesh archives.",
    tags: item.tags || [],
    matchedQueries: item.matchedQueries || [],
    dataUrl: null,
    format: "external_reference",
    nodeCount: Number(item.vertexCount || 0),
    triangleCount: Number(item.faceCount || 0),
    edgeCount: 0,
    sourceTriangleCount: Number(item.faceCount || 0),
    palette: {
      background: "#0f1a24",
      surface: "#d9d4c7",
      edge: "#80b4d8",
      node: "#f2be90"
    },
    catalogType: "historic",
    renderable: false,
    externalUrl: item.viewerUrl || null,
    embedUrl: item.embedUrl || null,
    thumbnailUrl: item.thumbnailUrl || null,
    publishedAt: item.publishedAt || null,
    archiveTypes: item.archiveTypes || [],
    license: item.license || null,
    popularityScore: Number(item.popularityScore || 0)
  };
}

function inferCenturyLabel(period) {
  if (!period) {
    return "";
  }
  const label = String(period).toLowerCase();
  if (label.includes("renaissance")) {
    return "15th-16th century";
  }
  if (label.includes("baroque")) {
    return "17th century";
  }
  if (label.includes("18th")) {
    return "18th century";
  }
  if (label.includes("19th") || label.includes("xix")) {
    return "19th century";
  }
  if (label.includes("neoclassic")) {
    return "18th-19th century";
  }
  return period;
}

function hydrateCollectionFilter(counts) {
  const localCount = counts.local || 0;
  const historicLoaded = counts.historicLoaded || 0;
  const historicTotal = counts.historicTotal || historicLoaded;
  const allCount = localCount + historicLoaded;
  const historicLabel =
    historicTotal > historicLoaded
      ? `Historic index (${NUMBER.format(historicLoaded)} / ${NUMBER.format(historicTotal)} loaded)`
      : `Historic index (${NUMBER.format(historicLoaded)})`;

  dom.collectionSelect.innerHTML = `
    <option value="all">All collections (${NUMBER.format(allCount)})</option>
    <option value="local">Renderable local meshes (${NUMBER.format(localCount)})</option>
    <option value="historic">${historicLabel}</option>
  `;
  dom.collectionSelect.value = state.scope;
}

function updateWorkBatchStatus() {
  const loaded = getHistoricLoadedCount();
  const remaining = state.historicQueue.length;
  if (state.historicTotal <= 0) {
    dom.workBatchStatus.textContent = "Historic works unavailable";
    dom.loadMoreWorksBtn.disabled = true;
    return;
  }

  dom.workBatchStatus.textContent = `Loaded ${NUMBER.format(loaded)} of ${NUMBER.format(state.historicTotal)} historic works`;
  dom.loadMoreWorksBtn.disabled = remaining === 0;
}

function getHistoricLoadedCount() {
  return state.catalog.reduce((sum, item) => sum + (item.catalogType === "historic" ? 1 : 0), 0);
}

function loadMoreHistoricBatch() {
  if (state.historicQueue.length === 0) {
    updateWorkBatchStatus();
    return;
  }

  const nextBatch = state.historicQueue.splice(0, state.batchSize);
  for (const item of nextBatch) {
    state.catalog.push(item);
    state.byId.set(item.id, item);
  }

  hydrateCollectionFilter({
    local: state.localTotal,
    historicLoaded: getHistoricLoadedCount(),
    historicTotal: state.historicTotal
  });
  updateWorkBatchStatus();
  hydrateStyleFilter();
  updateTopStats();
  applyFilters();
}

function updateTopStats() {
  const scoped = getScopedCatalog();
  const totalNodes = scoped.reduce((sum, item) => sum + Number(item.nodeCount || 0), 0);
  const totalTriangles = scoped.reduce((sum, item) => sum + Number(item.triangleCount || 0), 0);

  dom.statTotalWorks.textContent = NUMBER.format(scoped.length);
  dom.statTotalNodes.textContent = NUMBER.format(totalNodes);
  dom.statTotalTriangles.textContent = NUMBER.format(totalTriangles);
}

function hydrateStyleFilter() {
  const scoped = getScopedCatalog();
  const uniqueStyles = new Set();
  for (const item of scoped) {
    if (item.style) {
      uniqueStyles.add(item.style);
    }
  }

  const sorted = [...uniqueStyles].sort((a, b) => a.localeCompare(b));
  const options = sorted
    .map((style) => `<option value="${escapeHtml(style)}">${escapeHtml(style)}</option>`)
    .join("");

  dom.styleFilter.innerHTML = `<option value="all">All styles</option>${options}`;
  if (state.style !== "all" && !uniqueStyles.has(state.style)) {
    state.style = "all";
  }
  dom.styleFilter.value = state.style;
}

function applyFilters() {
  const query = state.search;
  const scoped = getScopedCatalog();
  const previousActiveId = state.activeId;

  const filtered = scoped.filter((item) => {
    if (state.style !== "all" && String(item.style || "") !== state.style) {
      return false;
    }

    if (!query) {
      return true;
    }

    const text = [
      item.title,
      item.artist,
      item.style,
      item.origin,
      item.year,
      item.creator,
      item.license,
      ...(item.archiveTypes || []),
      ...(item.matchedQueries || []),
      ...(item.tags || [])
    ]
      .join(" ")
      .toLowerCase();

    return text.includes(query);
  });

  sortItems(filtered, state.sort);
  state.filtered = filtered;

  if (!state.filtered.find((item) => item.id === state.activeId)) {
    state.activeId = state.filtered[0]?.id || null;
  }

  dom.resultsCount.textContent = `${NUMBER.format(state.filtered.length)} result${
    state.filtered.length === 1 ? "" : "s"
  }`;

  renderCatalogWindow(true);
  populateWorkDropdown();

  if (state.activeId && state.activeId !== previousActiveId) {
    void selectItem(state.activeId, { resetScroll: false });
    return;
  }

  if (!state.activeId) {
    setViewerControlsEnabled(false);
    viewer.showEmptyState();
    renderDetails(null, null);
  }
}

function sortItems(items, sortBy) {
  switch (sortBy) {
    case "nodes_desc":
      items.sort((a, b) => Number(b.nodeCount || 0) - Number(a.nodeCount || 0));
      break;
    case "triangles_desc":
      items.sort((a, b) => Number(b.triangleCount || 0) - Number(a.triangleCount || 0));
      break;
    case "popularity_desc":
      items.sort((a, b) => Number(b.popularityScore || 0) - Number(a.popularityScore || 0));
      break;
    case "artist_asc":
      items.sort((a, b) => (a.artist || "").localeCompare(b.artist || ""));
      break;
    case "title_asc":
    default:
      items.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      break;
  }
}

function renderCatalogWindow(resetScroll = false) {
  if (resetScroll) {
    dom.catalogScroll.scrollTop = 0;
  }

  const total = state.filtered.length;
  const totalHeight = total * ROW_HEIGHT + 20;
  dom.catalogSpacer.style.height = `${totalHeight}px`;

  if (total === 0) {
    dom.catalogItems.style.transform = "translateY(0px)";
    dom.catalogItems.innerHTML = `<div class="card-empty">No entries matched your filter.</div>`;
    return;
  }

  const scrollTop = dom.catalogScroll.scrollTop;
  const viewportHeight = dom.catalogScroll.clientHeight;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(total, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);

  const windowItems = state.filtered.slice(start, end);
  dom.catalogItems.style.transform = `translateY(${start * ROW_HEIGHT}px)`;
  dom.catalogItems.innerHTML = windowItems.map((item) => catalogCardHtml(item)).join("");
}

function catalogCardHtml(item) {
  const activeClass = item.id === state.activeId ? "active" : "";
  const sourceBadge = item.renderable ? "Renderable" : "Historic index";
  const triangleLabel = item.renderable ? "Triangles" : "Faces";
  const metricLabel = item.renderable ? "Nodes" : "Vertices";
  const media = item.thumbnailUrl
    ? `<img class="catalog-thumb" loading="lazy" decoding="async" src="${escapeHtml(item.thumbnailUrl)}" alt="${escapeHtml(
        `${item.title || "Sculpture"} preview`
      )}" />`
    : `<div class="catalog-thumb-fallback" aria-hidden="true"></div>`;

  return `
    <article class="catalog-card ${activeClass}" data-model-id="${escapeHtml(item.id)}" style="--accent:${
      item.palette?.edge || "#9bc9c6"
    }">
      <div class="catalog-media">${media}</div>
      <div class="catalog-copy">
        <h3>${escapeHtml(item.title || "Untitled")}</h3>
        <p class="meta">${escapeHtml(item.artist || "Unknown artist")} ${
    item.year ? "• " + escapeHtml(item.year) : ""
  }</p>
        <p class="meta">${metricLabel} ${NUMBER.format(Number(item.nodeCount || 0))} • ${triangleLabel} ${NUMBER.format(
    Number(item.triangleCount || 0)
  )}</p>
        <div class="pills">
          <span class="pill">${escapeHtml(item.style || "Unsorted")}</span>
          <span class="pill">${escapeHtml(sourceBadge)}</span>
        </div>
      </div>
    </article>
  `;
}

async function selectItem(id, options = {}) {
  if (!id) {
    return;
  }

  const item = state.byId.get(id);
  if (!item) {
    return;
  }

  state.activeId = id;
  if (dom.workSelect.querySelector(`option[value="${cssEscape(id)}"]`)) {
    dom.workSelect.value = id;
  }
  renderCatalogWindow(Boolean(options.resetScroll));
  renderDetails(item, null);

  const canRender = isRenderableItem(item);
  setViewerControlsEnabled(canRender);
  if (!canRender) {
    viewer.showReferenceOnly(item);
    renderDetails(item, null);
    return;
  }

  try {
    const stats = await viewer.load(item, state.quality);

    if (state.activeId !== item.id) {
      return;
    }

    viewer.setLayerVisibility(state.layers);
    viewer.setNodeSize(state.nodeSize);
    viewer.setAutoRotate(state.layers.autoRotate);
    renderDetails(item, stats);
  } catch (error) {
    if (String(error.message).includes("superseded")) {
      return;
    }
    viewer.setMessage(`Failed to render ${item.title}: ${error.message}`, true);
  }
}

function renderDetails(item, renderStats) {
  if (!item) {
    dom.detailsPanel.innerHTML = '<p class="details-empty">No sculpture selected.</p>';
    return;
  }

  const canRender = isRenderableItem(item);
  const sourceTriangles = Number(item.sourceTriangleCount || item.triangleCount || 0);
  const renderedTriangles = canRender ? Number(renderStats?.renderedTriangles || item.triangleCount || 0) : null;
  const renderedNodes = canRender ? Number(renderStats?.renderedNodes || item.nodeCount || 0) : null;
  const renderedEdges = canRender ? Number(renderStats?.renderedEdgeSegments || item.edgeCount || 0) : null;
  const profile = renderStats?.profileName || (state.quality === "auto" ? "auto" : state.quality);
  const sourceLabel = canRender ? "Source Triangles" : "Source Faces";
  const actionLink = item.externalUrl
    ? `<p><a class="detail-link" href="${escapeHtml(item.externalUrl)}" target="_blank" rel="noopener noreferrer">Open source model</a></p>`
    : "";
  const archiveLabel = item.archiveTypes?.length ? item.archiveTypes.join(", ") : "n/a";
  const modeLabel = canRender ? "Local Renderable Mesh" : "External Historic Listing";
  const profileLabel = canRender ? profile : "reference";
  const publishedLabel = item.publishedAt ? formatPublishedDate(item.publishedAt) : "n/a";
  const preview = item.thumbnailUrl
    ? `<figure class="details-preview"><img src="${escapeHtml(item.thumbnailUrl)}" alt="${escapeHtml(
        `${item.title || "Sculpture"} preview`
      )}" /></figure>`
    : "";

  dom.detailsPanel.innerHTML = `
    ${preview}
    <h2>${escapeHtml(item.title)}</h2>
    <p>${escapeHtml(item.artist || "Unknown artist")} ${item.year ? `(${escapeHtml(item.year)})` : ""}</p>
    <p>${escapeHtml(item.description || "No description available.")}</p>
    ${actionLink}
    <div class="stats-grid">
      <div><span>Rendered Triangles</span><strong>${formatMetric(renderedTriangles)}</strong></div>
      <div><span>${sourceLabel}</span><strong>${NUMBER.format(sourceTriangles)}</strong></div>
      <div><span>Rendered Nodes</span><strong>${formatMetric(renderedNodes)}</strong></div>
      <div><span>Edge Segments</span><strong>${formatMetric(renderedEdges)}</strong></div>
      <div><span>Profile</span><strong>${escapeHtml(profileLabel)}</strong></div>
      <div><span>Style</span><strong>${escapeHtml(item.style || "Unknown")}</strong></div>
      <div><span>Origin</span><strong>${escapeHtml(item.origin || "Unknown")}</strong></div>
      <div><span>Mode</span><strong>${escapeHtml(modeLabel)}</strong></div>
      <div><span>Published</span><strong>${escapeHtml(publishedLabel)}</strong></div>
      <div><span>Archives</span><strong>${escapeHtml(archiveLabel)}</strong></div>
      <div><span>License</span><strong>${escapeHtml(item.license || "n/a")}</strong></div>
      <div><span>Tags</span><strong>${escapeHtml((item.tags || []).slice(0, 2).join(" / ") || "none")}</strong></div>
    </div>
  `;
}

class AtlasViewer {
  constructor({ canvas, messageEl }) {
    this.canvas = canvas;
    this.messageEl = messageEl;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.root = null;

    this.layers = {
      surface: null,
      edges: null,
      nodes: null
    };

    this.nodeBaseSize = 0.012;
    this.lastFit = null;
    this.requestCounter = 0;
    this.latestRequestId = 0;
    this.pendingRequests = new Map();

    this.worker = new Worker(new URL("./model-worker.js", import.meta.url), { type: "module" });
    this.worker.onmessage = (event) => this.onWorkerMessage(event);

    this.animate = this.animate.bind(this);
    this.resize = this.resize.bind(this);
  }

  async init() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1315);

    const width = this.canvas.clientWidth || 2;
    const height = this.canvas.clientHeight || 2;
    this.camera = new THREE.PerspectiveCamera(46, width / height, 0.01, 2000);
    this.camera.position.set(0, 0.35, 2.4);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = true;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.65;

    this.root = new THREE.Group();
    this.scene.add(this.root);

    const hemi = new THREE.HemisphereLight(0xe8f4ff, 0x1f2b2f, 0.74);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff4dc, 1.15);
    key.position.set(2.7, 2.2, 1.8);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x88d1d7, 0.58);
    rim.position.set(-2.5, 1.3, -2.8);
    this.scene.add(rim);

    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 80),
      new THREE.MeshBasicMaterial({ color: 0x0b1819, transparent: true, opacity: 0.62 })
    );
    this.floor.rotation.x = -Math.PI * 0.5;
    this.floor.position.y = -0.9;
    this.scene.add(this.floor);

    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(this.canvas.parentElement);

    window.addEventListener("resize", this.resize);
    this.animate();
  }

  onWorkerMessage(event) {
    const payload = event.data || {};
    const pending = this.pendingRequests.get(payload.requestId);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(payload.requestId);

    if (!payload.ok) {
      pending.reject(new Error(payload.error || "Worker failed to process geometry."));
      return;
    }

    pending.resolve(payload.model);
  }

  async load(item, qualityName) {
    this.setMessage(`Loading ${item.title}...`);

    const requestId = ++this.requestCounter;
    this.latestRequestId = requestId;

    const resultPromise = new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
    });

    this.worker.postMessage({
      requestId,
      item,
      profileName: qualityName
    });

    const model = await resultPromise;

    if (requestId !== this.latestRequestId) {
      throw new Error("superseded");
    }

    this.applyModel(item, model);
    this.setMessage(
      `Profile ${model.profileName}: ${NUMBER.format(model.stats.renderedTriangles)} triangles, ${NUMBER.format(
        model.stats.renderedNodes
      )} nodes.`
    );

    return {
      ...model.stats,
      profileName: model.profileName
    };
  }

  showReferenceOnly(item) {
    this.disposeLayers();
    const palette = item.palette || {};
    this.scene.background = new THREE.Color(palette.background || "#0f1a24");
    this.setMessage("Metadata entry only. Open the source model from details.");
  }

  showEmptyState() {
    this.disposeLayers();
    this.setMessage("No matching sculptures. Adjust search or filters.");
  }

  applyModel(item, model) {
    this.disposeLayers();

    const palette = item.palette || {};
    this.scene.background = new THREE.Color(palette.background || "#0b1315");

    if (model.surface && model.surface.positions.length > 0 && model.surface.indices.length > 0) {
      const surfaceGeometry = new THREE.BufferGeometry();
      surfaceGeometry.setAttribute("position", new THREE.BufferAttribute(model.surface.positions, 3));
      surfaceGeometry.setIndex(new THREE.BufferAttribute(model.surface.indices, 1));

      const renderedTriangles = Math.floor(model.surface.indices.length / 3);
      let surfaceMaterial;

      if (renderedTriangles > 550_000) {
        surfaceMaterial = new THREE.MeshBasicMaterial({
          color: palette.surface || "#d8ceb6",
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide
        });
      } else {
        surfaceGeometry.computeVertexNormals();
        surfaceMaterial = new THREE.MeshStandardMaterial({
          color: palette.surface || "#d8ceb6",
          roughness: 0.75,
          metalness: 0.05,
          transparent: true,
          opacity: 0.86,
          flatShading: renderedTriangles > 300_000,
          side: THREE.DoubleSide
        });
      }

      this.layers.surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
      this.root.add(this.layers.surface);
    }

    if (model.edges && model.edges.positions.length > 0) {
      const edgeGeometry = new THREE.BufferGeometry();
      edgeGeometry.setAttribute("position", new THREE.BufferAttribute(model.edges.positions, 3));
      const edgeMaterial = new THREE.LineBasicMaterial({
        color: palette.edge || "#7dc4c1",
        transparent: true,
        opacity: 0.42
      });
      this.layers.edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
      this.root.add(this.layers.edges);
    }

    if (model.nodes && model.nodes.positions.length > 0) {
      const nodeGeometry = new THREE.BufferGeometry();
      nodeGeometry.setAttribute("position", new THREE.BufferAttribute(model.nodes.positions, 3));

      this.nodeBaseSize = this.deriveNodeSize(model.stats.renderedNodes);

      const nodeMaterial = new THREE.PointsMaterial({
        color: palette.node || "#f0b88b",
        size: this.nodeBaseSize,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9
      });
      this.layers.nodes = new THREE.Points(nodeGeometry, nodeMaterial);
      this.root.add(this.layers.nodes);
    }

    this.fitToCurrentModel();
  }

  deriveNodeSize(renderedNodes) {
    if (renderedNodes > 700_000) {
      return 0.004;
    }
    if (renderedNodes > 350_000) {
      return 0.006;
    }
    if (renderedNodes > 100_000) {
      return 0.009;
    }
    return 0.012;
  }

  fitToCurrentModel() {
    const bounds = new THREE.Box3();
    let hasBounds = false;

    for (const key of ["surface", "edges", "nodes"]) {
      const layer = this.layers[key];
      if (!layer) {
        continue;
      }
      bounds.expandByObject(layer);
      hasBounds = true;
    }

    if (!hasBounds) {
      return;
    }

    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const distance = maxDim * 1.75;

    this.camera.position.set(center.x + distance * 0.35, center.y + distance * 0.22, center.z + distance);
    this.camera.near = Math.max(maxDim / 1200, 0.001);
    this.camera.far = Math.max(maxDim * 120, 200);
    this.camera.updateProjectionMatrix();

    this.controls.target.copy(center);
    this.controls.update();

    this.lastFit = {
      center,
      distance
    };

    this.floor.position.set(center.x, center.y - maxDim * 0.62, center.z);
    this.floor.scale.setScalar(Math.max(maxDim * 1.2, 1));
  }

  setLayerVisibility(config) {
    if (this.layers.surface) {
      this.layers.surface.visible = Boolean(config.surface);
    }
    if (this.layers.edges) {
      this.layers.edges.visible = Boolean(config.edges);
    }
    if (this.layers.nodes) {
      this.layers.nodes.visible = Boolean(config.nodes);
    }
  }

  setNodeSize(multiplier) {
    if (!this.layers.nodes) {
      return;
    }

    const mat = this.layers.nodes.material;
    mat.size = this.nodeBaseSize * Math.max(0.1, multiplier);
    mat.needsUpdate = true;
  }

  setAutoRotate(enabled) {
    this.controls.autoRotate = Boolean(enabled);
  }

  recenter() {
    if (!this.lastFit) {
      return;
    }

    const { center, distance } = this.lastFit;
    this.camera.position.set(center.x + distance * 0.35, center.y + distance * 0.22, center.z + distance);
    this.controls.target.copy(center);
    this.controls.update();
  }

  disposeLayers() {
    for (const key of Object.keys(this.layers)) {
      const layer = this.layers[key];
      if (!layer) {
        continue;
      }

      if (layer.geometry) {
        layer.geometry.dispose();
      }
      if (layer.material) {
        if (Array.isArray(layer.material)) {
          for (const material of layer.material) {
            material.dispose();
          }
        } else {
          layer.material.dispose();
        }
      }

      this.root.remove(layer);
      this.layers[key] = null;
    }
  }

  setMessage(text, isError = false) {
    this.messageEl.textContent = text;
    this.messageEl.style.borderColor = isError ? "rgba(244, 127, 111, 0.7)" : "rgba(144, 179, 172, 0.33)";
    this.messageEl.style.color = isError ? "#ffd6d0" : "#c3d8d3";
  }

  resize() {
    if (!this.renderer || !this.camera) {
      return;
    }

    const parent = this.canvas.parentElement;
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    if (width <= 0 || height <= 0) {
      return;
    }

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  animate() {
    requestAnimationFrame(this.animate);

    if (!this.renderer || !this.scene || !this.camera || !this.controls) {
      return;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

function getById(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing expected DOM node: #${id}`);
  }
  return element;
}

function getScopedCatalog() {
  if (state.scope === "all") {
    return state.catalog;
  }
  return state.catalog.filter((item) => item.catalogType === state.scope);
}

function populateWorkDropdown() {
  const scoped = getScopedCatalog()
    .slice()
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""));

  const options = scoped
    .map((item) => {
      const artist = item.artist ? ` — ${item.artist}` : "";
      return `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title || "Untitled")}${escapeHtml(artist)}</option>`;
    })
    .join("");

  if (!options) {
    dom.workSelect.innerHTML = `<option value="">No works available</option>`;
    dom.workSelect.disabled = true;
    dom.workSelect.value = "";
    return;
  }

  dom.workSelect.innerHTML = options;
  dom.workSelect.disabled = false;
  if (state.activeId && scoped.some((item) => item.id === state.activeId)) {
    dom.workSelect.value = state.activeId;
  } else {
    dom.workSelect.selectedIndex = -1;
  }
}

function isRenderableItem(item) {
  return Boolean(item && item.renderable && item.dataUrl);
}

function setViewerControlsEnabled(enabled) {
  const controls = [
    dom.qualitySelect,
    dom.nodeSize,
    dom.toggleNodes,
    dom.toggleEdges,
    dom.toggleSurface,
    dom.toggleRotate,
    dom.recenterBtn
  ];

  for (const control of controls) {
    control.disabled = !enabled;
  }
}

function formatMetric(value) {
  return Number.isFinite(value) ? NUMBER.format(value) : "n/a";
}

function formatPublishedDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "n/a";
  }
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function formatHistoricStyle(value) {
  if (!value) {
    return "";
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  if (normalized.includes("renaissance")) {
    return "Renaissance";
  }
  if (normalized.includes("baroque")) {
    return "Baroque";
  }
  if (normalized.includes("neoclassic")) {
    return "Neoclassical";
  }
  if (normalized.includes("romantic")) {
    return "Romantic";
  }
  if (normalized.includes("19th")) {
    return "19th Century";
  }
  if (normalized.includes("18th")) {
    return "18th Century";
  }
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatHistoricArtist(value) {
  if (!value) {
    return "";
  }

  return String(value)
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((token) =>
      token
        .split("-")
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
        .join("-")
    )
    .join(" ");
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(String(value));
  }
  return String(value).replace(/\"/g, "\\\"");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
