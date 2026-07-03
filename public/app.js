(function () {
  "use strict";

  const elements = {
    app: document.getElementById("app"),
    sidebar: document.getElementById("sidebar"),
    sidebarBackdrop: document.getElementById("sidebar-backdrop"),
    menuButton: document.getElementById("menu-button"),
    navItems: Array.from(document.querySelectorAll("[data-view]")),
    logoutButton: document.getElementById("logout-button"),
    settingsLogoutButton: document.getElementById("settings-logout-button"),
    refreshButton: document.getElementById("refresh-button"),
    searchForm: document.getElementById("search-form"),
    searchInput: document.getElementById("search-input"),
    clearSearch: document.getElementById("clear-search"),
    browserView: document.getElementById("browser-view"),
    settingsView: document.getElementById("settings-view"),
    breadcrumbs: document.getElementById("breadcrumbs"),
    pageTitle: document.getElementById("page-title"),
    newFolderButton: document.getElementById("new-folder-button"),
    uploadButton: document.getElementById("upload-button"),
    fileInput: document.getElementById("file-input"),
    selectionBar: document.getElementById("selection-bar"),
    selectionCount: document.getElementById("selection-count"),
    resultSummary: document.getElementById("result-summary"),
    sortSelect: document.getElementById("sort-select"),
    listViewButton: document.getElementById("list-view-button"),
    gridViewButton: document.getElementById("grid-view-button"),
    dropZone: document.getElementById("drop-zone"),
    dropOverlay: document.getElementById("drop-overlay"),
    loadingState: document.getElementById("loading-state"),
    emptyState: document.getElementById("empty-state"),
    errorState: document.getElementById("error-state"),
    errorStateMessage: document.getElementById("error-state-message"),
    fileTableWrap: document.getElementById("file-table-wrap"),
    fileTableBody: document.getElementById("file-table-body"),
    selectAll: document.getElementById("select-all"),
    fileGrid: document.getElementById("file-grid"),
    formDialog: document.getElementById("form-dialog"),
    dialogForm: document.getElementById("dialog-form"),
    dialogEyebrow: document.getElementById("dialog-eyebrow"),
    dialogTitle: document.getElementById("dialog-title"),
    dialogDescription: document.getElementById("dialog-description"),
    dialogFields: document.getElementById("dialog-fields"),
    dialogError: document.getElementById("dialog-error"),
    dialogSubmit: document.getElementById("dialog-submit"),
    previewDialog: document.getElementById("preview-dialog"),
    previewTitle: document.getElementById("preview-title"),
    previewMeta: document.getElementById("preview-meta"),
    previewBody: document.getElementById("preview-body"),
    previewDownload: document.getElementById("preview-download"),
    contextMenu: document.getElementById("context-menu"),
    uploadPanel: document.getElementById("upload-panel"),
    uploadTitle: document.getElementById("upload-title"),
    uploadSummary: document.getElementById("upload-summary"),
    uploadItems: document.getElementById("upload-items"),
    uploadPanelClose: document.getElementById("upload-panel-close"),
    statusLoading: document.getElementById("status-loading"),
    statusContent: document.getElementById("status-content"),
    statusRoot: document.getElementById("status-root"),
    statusPort: document.getElementById("status-port"),
    statusAddresses: document.getElementById("status-addresses"),
    statusVersion: document.getElementById("status-version"),
    storageUsed: document.getElementById("storage-used"),
    storageTotal: document.getElementById("storage-total"),
    storageFree: document.getElementById("storage-free"),
    storageBarFill: document.getElementById("storage-bar-fill"),
    firewallCard: document.getElementById("firewall-card"),
    firewallMessage: document.getElementById("firewall-message"),
    toastRegion: document.getElementById("toast-region")
  };

  const state = {
    view: "files",
    currentPath: "",
    items: [],
    visibleItems: [],
    selected: new Set(),
    display: localStorage.getItem("nas-display") === "grid" ? "grid" : "list",
    sort: localStorage.getItem("nas-sort") || "name:asc",
    query: "",
    requestId: 0,
    contextItem: null,
    previewItem: null,
    flvPlayer: null,
    pdfDocument: null,
    pdfLoadingTask: null,
    pdfRenderTask: null,
    pdfResizeObserver: null,
    pdfModulePromise: null,
    pdfPage: 1,
    pdfZoom: 1,
    dialogResolve: null,
    uploads: new Map(),
    searchTimer: null,
    dragging: 0
  };

  const kindLabels = {
    folder: "文件夹",
    image: "图片",
    video: "视频",
    pdf: "PDF 文档",
    document: "Word 文档",
    sheet: "表格",
    text: "文本文件",
    archive: "压缩文件",
    other: "文件"
  };

  function apiUrl(path, query) {
    return NasApi.buildUrl(path, query);
  }

  function normalizeItem(item, view) {
    const raw = item || {};
    const name = String(raw.name || raw.fileName || baseName(raw.path || raw.originalPath || "") || "未命名");
    const path = String(raw.path || raw.relativePath || raw.originalPath || joinPath(state.currentPath, name));
    const directory = raw.isDirectory === true || raw.directory === true || ["folder", "directory", "dir"].includes(String(raw.type || raw.kind || "").toLowerCase());
    const id = raw.id === undefined || raw.id === null ? "" : String(raw.id);
    return {
      raw,
      id,
      key: view === "recycle" ? (id || path) : path,
      name,
      path,
      directory,
      size: Number(raw.size ?? raw.bytes ?? 0) || 0,
      mime: String(raw.mime || raw.mimeType || raw.contentType || ""),
      modifiedAt: raw.modifiedAt || raw.mtime || raw.modified || raw.updatedAt || raw.uploadedAt || raw.createdAt || "",
      uploadedAt: raw.uploadedAt || raw.createdAt || raw.modifiedAt || "",
      deletedAt: raw.deletedAt || raw.removedAt || "",
      originalPath: String(raw.originalPath || raw.path || ""),
      kind: directory ? "folder" : fileKind(name, raw.mime || raw.mimeType || raw.type)
    };
  }

  function fileKind(name, mimeValue) {
    const mime = String(mimeValue || "").toLowerCase();
    const extension = extensionOf(name);
    if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif"].includes(extension)) return "image";
    if (mime.startsWith("video/") || ["mp4", "webm", "mov", "m4v", "ogv", "mkv", "avi", "hevc", "flv"].includes(extension)) return "video";
    if (mime === "application/pdf" || extension === "pdf") return "pdf";
    if (["docx", "doc"].includes(extension)) return "document";
    if (["xlsx", "xls", "csv", "tsv"].includes(extension)) return "sheet";
    if (mime.startsWith("text/") || ["txt", "md", "json", "xml", "yaml", "yml", "log", "ini", "css", "js", "html", "htm"].includes(extension)) return "text";
    if (["zip", "7z", "rar", "tar", "gz"].includes(extension)) return "archive";
    return "other";
  }

  function extensionOf(name) {
    const index = String(name).lastIndexOf(".");
    return index > 0 ? String(name).slice(index + 1).toLowerCase() : "";
  }

  function baseName(path) {
    const parts = String(path || "").replace(/\\/g, "/").split("/").filter(Boolean);
    return parts[parts.length - 1] || "";
  }

  function parentPath(path) {
    const parts = String(path || "").split("/").filter(Boolean);
    parts.pop();
    return parts.join("/");
  }

  function joinPath(parent, name) {
    return [String(parent || "").replace(/\/+$/g, ""), String(name || "").replace(/^\/+/g, "")].filter(Boolean).join("/");
  }

  function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return "—";
    if (value === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const amount = value / Math.pow(1024, unitIndex);
    return `${amount >= 100 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = typeof value === "number" && value < 100000000000 ? new Date(value * 1000) : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function compareItems(left, right) {
    if (left.directory !== right.directory && state.view === "files") return left.directory ? -1 : 1;
    const [field, direction] = state.sort.split(":");
    let result = 0;
    if (field === "name") {
      result = left.name.localeCompare(right.name, "zh-CN", { numeric: true, sensitivity: "base" });
    } else if (field === "size") {
      result = left.size - right.size;
    } else {
      const leftTime = new Date(left.modifiedAt || left.uploadedAt || left.deletedAt || 0).getTime() || 0;
      const rightTime = new Date(right.modifiedAt || right.uploadedAt || right.deletedAt || 0).getTime() || 0;
      result = leftTime - rightTime;
    }
    return direction === "desc" ? -result : result;
  }

  async function initialize() {
    bindEvents();
    elements.sortSelect.value = state.sort;
    setDisplay(state.display);
    try {
      const session = await NasApi.json("/api/auth/me");
      if (!session.authenticated) {
        redirectToLogin();
        return;
      }
      elements.app.setAttribute("aria-busy", "false");
      await loadCurrentView();
    } catch (error) {
      if (error.status === 401) {
        redirectToLogin();
      } else {
        elements.app.setAttribute("aria-busy", "false");
        showLoadError(error.message);
      }
    }
  }

  function bindEvents() {
    elements.navItems.forEach((button) => {
      button.addEventListener("click", () => changeView(button.dataset.view));
    });
    elements.menuButton.addEventListener("click", openSidebar);
    elements.sidebarBackdrop.addEventListener("click", closeSidebar);
    elements.logoutButton.addEventListener("click", logout);
    elements.settingsLogoutButton.addEventListener("click", logout);
    elements.refreshButton.addEventListener("click", () => {
      if (state.view === "files" && state.query) runSearch(state.query);
      else loadCurrentView();
    });
    elements.searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      runSearch(elements.searchInput.value.trim());
    });
    elements.searchInput.addEventListener("input", () => {
      elements.clearSearch.hidden = !elements.searchInput.value;
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => runSearch(elements.searchInput.value.trim()), 320);
    });
    elements.clearSearch.addEventListener("click", () => {
      elements.searchInput.value = "";
      elements.clearSearch.hidden = true;
      runSearch("");
      elements.searchInput.focus();
    });
    elements.sortSelect.addEventListener("change", () => {
      state.sort = elements.sortSelect.value;
      localStorage.setItem("nas-sort", state.sort);
      renderItems();
    });
    elements.listViewButton.addEventListener("click", () => setDisplay("list"));
    elements.gridViewButton.addEventListener("click", () => setDisplay("grid"));
    elements.newFolderButton.addEventListener("click", createFolder);
    elements.uploadButton.addEventListener("click", () => {
      if (state.view === "recycle") {
        emptyRecycleBin();
      } else {
        elements.fileInput.click();
      }
    });
    elements.fileInput.addEventListener("change", () => {
      uploadFiles(Array.from(elements.fileInput.files || []));
      elements.fileInput.value = "";
    });
    elements.selectAll.addEventListener("change", () => {
      if (elements.selectAll.checked) {
        state.visibleItems.forEach((item) => state.selected.add(item.key));
      } else {
        state.selected.clear();
      }
      renderItems();
    });
    elements.selectionBar.addEventListener("click", handleSelectionAction);
    elements.fileTableBody.addEventListener("click", handleCollectionClick);
    elements.fileGrid.addEventListener("click", handleCollectionClick);
    elements.fileTableBody.addEventListener("dblclick", handleCollectionDoubleClick);
    elements.fileGrid.addEventListener("dblclick", handleCollectionDoubleClick);
    document.querySelectorAll("[data-empty-action]").forEach((button) => {
      button.addEventListener("click", () => button.dataset.emptyAction === "retry" ? loadCurrentView() : elements.fileInput.click());
    });
    document.querySelectorAll("[data-dialog-close]").forEach((button) => button.addEventListener("click", closeFormDialog));
    elements.dialogForm.addEventListener("submit", submitFormDialog);
    elements.formDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeFormDialog();
    });
    elements.previewDialog.querySelector("[data-preview-close]").addEventListener("click", () => elements.previewDialog.close());
    elements.previewDialog.addEventListener("close", cleanupPreview);
    elements.previewDownload.addEventListener("click", () => state.previewItem && downloadItems([state.previewItem]));
    elements.contextMenu.addEventListener("click", handleContextAction);
    elements.uploadPanelClose.addEventListener("click", () => {
      elements.uploadPanel.hidden = true;
    });
    document.addEventListener("click", (event) => {
      if (!elements.contextMenu.contains(event.target) && !event.target.closest("[data-action='menu']")) {
        hideContextMenu();
      }
    });
    window.addEventListener("resize", hideContextMenu);
    bindDropZone();
  }

  function bindDropZone() {
    ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
      elements.dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    });
    elements.dropZone.addEventListener("dragenter", () => {
      if (state.view !== "files") return;
      state.dragging += 1;
      elements.dropOverlay.hidden = false;
    });
    elements.dropZone.addEventListener("dragleave", () => {
      state.dragging = Math.max(0, state.dragging - 1);
      if (!state.dragging) elements.dropOverlay.hidden = true;
    });
    elements.dropZone.addEventListener("drop", (event) => {
      state.dragging = 0;
      elements.dropOverlay.hidden = true;
      if (state.view === "files") uploadFiles(Array.from(event.dataTransfer.files || []));
    });
  }

  function openSidebar() {
    elements.sidebar.classList.add("is-open");
    elements.sidebarBackdrop.hidden = false;
    elements.menuButton.setAttribute("aria-expanded", "true");
  }

  function closeSidebar() {
    elements.sidebar.classList.remove("is-open");
    elements.sidebarBackdrop.hidden = true;
    elements.menuButton.setAttribute("aria-expanded", "false");
  }

  async function changeView(view, path) {
    closeSidebar();
    if (!["files", "recent", "recycle", "settings"].includes(view)) return;
    state.view = view;
    if (view === "files" && path !== undefined) state.currentPath = path;
    state.query = "";
    elements.searchInput.value = "";
    elements.clearSearch.hidden = true;
    state.selected.clear();
    updateViewChrome();
    await loadCurrentView();
  }

  function updateViewChrome() {
    elements.navItems.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === state.view);
    });
    const settings = state.view === "settings";
    elements.browserView.hidden = settings;
    elements.settingsView.hidden = !settings;
    elements.searchForm.hidden = settings;
    elements.refreshButton.hidden = false;
    elements.newFolderButton.hidden = state.view !== "files";
    elements.uploadButton.hidden = state.view === "recent" || settings;
    elements.uploadButton.classList.toggle("button-danger", state.view === "recycle");
    elements.uploadButton.classList.toggle("button-primary", state.view !== "recycle");
    elements.uploadButton.innerHTML = state.view === "recycle" ? "<span aria-hidden=\"true\">×</span> 清空回收站" : "<span aria-hidden=\"true\">⇧</span> 上传";
    elements.searchInput.placeholder = state.view === "files" ? "搜索当前文件夹" : state.view === "recent" ? "筛选最近上传" : "筛选回收站";
    updateSelectionBar();
  }

  async function loadCurrentView() {
    if (state.view === "settings") {
      await loadStatus();
      return;
    }
    setLoading();
    const requestId = ++state.requestId;
    try {
      let data;
      if (state.view === "files") {
        data = await NasApi.json(apiUrl("/api/files/list", { path: state.currentPath }));
      } else if (state.view === "recent") {
        data = await NasApi.json("/api/recent");
      } else {
        data = await NasApi.json("/api/recycle/list");
      }
      if (requestId !== state.requestId) return;
      state.items = (Array.isArray(data.items) ? data.items : []).map((item) => normalizeItem(item, state.view));
      state.selected.clear();
      renderHeading();
      renderItems();
    } catch (error) {
      if (requestId !== state.requestId) return;
      handleApiError(error, true);
    }
  }

  async function runSearch(query) {
    state.query = query;
    if (state.view === "files" && query) {
      setLoading();
      const requestId = ++state.requestId;
      try {
        const data = await NasApi.json(apiUrl("/api/files/search", { query, path: state.currentPath }));
        if (requestId !== state.requestId) return;
        state.items = (Array.isArray(data.items) ? data.items : []).map((item) => normalizeItem(item, state.view));
        state.selected.clear();
        renderHeading();
        renderItems();
      } catch (error) {
        if (requestId === state.requestId) handleApiError(error, true);
      }
    } else if (state.view === "files") {
      await loadCurrentView();
    } else {
      state.selected.clear();
      renderItems();
    }
  }

  function renderHeading() {
    if (state.view === "files") {
      elements.pageTitle.textContent = state.query ? `“${state.query}”的搜索结果` : (baseName(state.currentPath) || "文件");
      renderBreadcrumbs();
    } else {
      elements.pageTitle.textContent = state.view === "recent" ? "最近上传" : "回收站";
      elements.breadcrumbs.replaceChildren();
    }
  }

  function renderBreadcrumbs() {
    elements.breadcrumbs.replaceChildren();
    const segments = state.currentPath.split("/").filter(Boolean);
    const entries = [{ name: "家庭 NAS", path: "" }];
    let accumulated = "";
    segments.forEach((segment) => {
      accumulated = joinPath(accumulated, segment);
      entries.push({ name: segment, path: accumulated });
    });
    entries.forEach((entry, index) => {
      if (index) {
        const separator = document.createElement("span");
        separator.textContent = "›";
        separator.setAttribute("aria-hidden", "true");
        elements.breadcrumbs.appendChild(separator);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "breadcrumb-button";
      button.textContent = entry.name;
      if (index === entries.length - 1) {
        button.setAttribute("aria-current", "page");
      } else {
        button.addEventListener("click", () => navigateToPath(entry.path));
      }
      elements.breadcrumbs.appendChild(button);
    });
  }

  function renderItems() {
    let items = state.items.slice();
    if (state.query && state.view !== "files") {
      const needle = state.query.toLocaleLowerCase("zh-CN");
      items = items.filter((item) => item.name.toLocaleLowerCase("zh-CN").includes(needle) || item.originalPath.toLocaleLowerCase("zh-CN").includes(needle));
    }
    items.sort(compareItems);
    state.visibleItems = items;
    const visibleKeys = new Set(items.map((item) => item.key));
    state.selected.forEach((key) => {
      if (!visibleKeys.has(key)) state.selected.delete(key);
    });

    elements.loadingState.hidden = true;
    elements.errorState.hidden = true;
    elements.emptyState.hidden = items.length > 0;
    elements.fileTableWrap.hidden = !items.length || state.display !== "list";
    elements.fileGrid.hidden = !items.length || state.display !== "grid";
    elements.resultSummary.textContent = state.query ? `找到 ${items.length} 项` : `${items.length} 项`;
    updateEmptyState();
    elements.fileTableBody.replaceChildren(...items.map(createTableRow));
    elements.fileGrid.replaceChildren(...items.map(createFileCard));
    updateSelectionBar();
  }

  function createTableRow(item) {
    const row = document.createElement("tr");
    row.className = "file-row";
    row.dataset.key = item.key;
    row.classList.toggle("is-selected", state.selected.has(item.key));

    const selectCell = document.createElement("td");
    selectCell.className = "select-column";
    selectCell.appendChild(createCheckbox(item));

    const nameCell = document.createElement("td");
    const nameWrap = document.createElement("div");
    nameWrap.className = "file-name-cell";
    nameWrap.append(createFileIcon(item), createNameButton(item));
    nameCell.appendChild(nameWrap);

    const timeCell = document.createElement("td");
    timeCell.textContent = formatDate(state.view === "recycle" ? item.deletedAt : state.view === "recent" ? item.uploadedAt : item.modifiedAt);
    const typeCell = document.createElement("td");
    typeCell.textContent = kindLabels[item.kind] || "文件";
    const sizeCell = document.createElement("td");
    sizeCell.textContent = item.directory ? "—" : formatBytes(item.size);
    const actionCell = document.createElement("td");
    actionCell.className = "actions-column";
    actionCell.appendChild(createMoreButton(item));
    row.append(selectCell, nameCell, timeCell, typeCell, sizeCell, actionCell);
    return row;
  }

  function createFileCard(item) {
    const card = document.createElement("article");
    card.className = "file-card";
    card.dataset.key = item.key;
    card.classList.toggle("is-selected", state.selected.has(item.key));
    const checkbox = createCheckbox(item);
    checkbox.className = "file-card-checkbox";
    const more = createMoreButton(item);
    more.classList.add("file-card-more");
    const thumbnail = document.createElement("div");
    thumbnail.className = "thumbnail";
    if (item.kind === "image" && state.view !== "recycle") {
      const image = document.createElement("img");
      image.alt = "";
      image.loading = "lazy";
      image.src = apiUrl("/api/files/stream", { path: item.path });
      image.addEventListener("error", () => thumbnail.replaceChildren(createFileIcon(item)));
      thumbnail.appendChild(image);
    } else {
      thumbnail.appendChild(createFileIcon(item));
    }
    const name = createNameButton(item);
    name.className = "file-card-name";
    const meta = document.createElement("div");
    meta.className = "file-card-meta";
    meta.textContent = item.directory ? "文件夹" : formatBytes(item.size);
    card.append(checkbox, more, thumbnail, name, meta);
    return card;
  }

  function createCheckbox(item) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selected.has(item.key);
    checkbox.dataset.action = "select";
    checkbox.dataset.key = item.key;
    checkbox.setAttribute("aria-label", `选择 ${item.name}`);
    return checkbox;
  }

  function createNameButton(item) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "file-name-button";
    button.dataset.action = "open";
    button.dataset.key = item.key;
    button.title = item.name;
    button.textContent = item.name;
    return button;
  }

  function createMoreButton(item) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "row-more-button";
    button.dataset.action = "menu";
    button.dataset.key = item.key;
    button.setAttribute("aria-label", `${item.name} 的更多操作`);
    button.textContent = "⋯";
    return button;
  }

  function createFileIcon(item) {
    const icon = document.createElement("span");
    icon.className = `file-icon${item.directory ? " is-folder" : ""}`;
    icon.dataset.kind = item.kind;
    icon.setAttribute("aria-hidden", "true");
    const labels = { image: "IMG", video: "VID", pdf: "PDF", document: "DOC", sheet: "XLS", text: "TXT", archive: "ZIP", other: "FILE" };
    icon.textContent = item.directory ? "" : (labels[item.kind] || "FILE");
    return icon;
  }

  function setDisplay(display) {
    state.display = display;
    localStorage.setItem("nas-display", display);
    elements.listViewButton.classList.toggle("is-active", display === "list");
    elements.gridViewButton.classList.toggle("is-active", display === "grid");
    elements.listViewButton.setAttribute("aria-pressed", String(display === "list"));
    elements.gridViewButton.setAttribute("aria-pressed", String(display === "grid"));
    if (state.visibleItems.length || state.items.length) renderItems();
  }

  function updateEmptyState() {
    const title = elements.emptyState.querySelector("h2");
    const description = elements.emptyState.querySelector("p");
    const action = elements.emptyState.querySelector("[data-empty-action='upload']");
    if (state.query) {
      title.textContent = "没有找到匹配项";
      description.textContent = "请尝试更换关键词，或清除搜索条件。";
      action.hidden = true;
    } else if (state.view === "recent") {
      title.textContent = "还没有最近上传";
      description.textContent = "上传后的文件会显示在这里。";
      action.hidden = true;
    } else if (state.view === "recycle") {
      title.textContent = "回收站是空的";
      description.textContent = "删除的文件会在这里保留 30 天。";
      action.hidden = true;
    } else {
      title.textContent = "这里还没有文件";
      description.textContent = "上传文件，或新建一个文件夹开始整理。";
      action.hidden = false;
    }
  }

  function setLoading() {
    elements.loadingState.hidden = false;
    elements.emptyState.hidden = true;
    elements.errorState.hidden = true;
    elements.fileTableWrap.hidden = true;
    elements.fileGrid.hidden = true;
    elements.resultSummary.textContent = "正在载入…";
  }

  function showLoadError(message) {
    elements.loadingState.hidden = true;
    elements.emptyState.hidden = true;
    elements.fileTableWrap.hidden = true;
    elements.fileGrid.hidden = true;
    elements.errorState.hidden = false;
    elements.errorStateMessage.textContent = message;
    elements.resultSummary.textContent = "载入失败";
  }

  function handleCollectionClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const item = findItem(target.dataset.key);
    if (!item) return;
    if (target.dataset.action === "select") {
      toggleSelection(item, target.checked);
    } else if (target.dataset.action === "open") {
      openItem(item);
    } else if (target.dataset.action === "menu") {
      event.stopPropagation();
      showContextMenu(item, target);
    }
  }

  function handleCollectionDoubleClick(event) {
    const container = event.target.closest("[data-key]");
    if (!container || event.target.matches("input, button")) return;
    const item = findItem(container.dataset.key);
    if (item) openItem(item);
  }

  function findItem(key) {
    return state.visibleItems.find((item) => item.key === key) || state.items.find((item) => item.key === key);
  }

  function toggleSelection(item, selected) {
    if (selected) state.selected.add(item.key);
    else state.selected.delete(item.key);
    renderItems();
  }

  function selectedItems() {
    return state.items.filter((item) => state.selected.has(item.key));
  }

  function updateSelectionBar() {
    const count = state.selected.size;
    elements.selectionBar.hidden = !count;
    elements.selectionCount.textContent = String(count);
    elements.selectAll.checked = Boolean(state.visibleItems.length) && state.visibleItems.every((item) => state.selected.has(item.key));
    elements.selectAll.indeterminate = count > 0 && !elements.selectAll.checked;
    const actionButtons = Array.from(elements.selectionBar.querySelectorAll("[data-selection-action]"));
    actionButtons.forEach((button) => {
      const action = button.dataset.selectionAction;
      if (state.view === "recycle") {
        button.hidden = !["download", "delete", "clear"].includes(action);
        if (action === "download") button.textContent = "恢复";
        if (action === "delete") button.textContent = "永久删除";
      } else {
        button.hidden = false;
        if (action === "download") {
          const items = selectedItems();
          button.textContent = items.length > 1 || items.some((item) => item.directory) ? "下载 ZIP" : "下载";
        }
        if (action === "delete") button.textContent = "删除";
      }
    });
  }

  async function handleSelectionAction(event) {
    const button = event.target.closest("[data-selection-action]");
    if (!button) return;
    const items = selectedItems();
    if (button.dataset.selectionAction === "clear") {
      state.selected.clear();
      renderItems();
    } else if (state.view === "recycle" && button.dataset.selectionAction === "download") {
      await restoreRecycleItems(items);
    } else if (state.view === "recycle" && button.dataset.selectionAction === "delete") {
      await purgeRecycleItems(items);
    } else if (button.dataset.selectionAction === "download") {
      await downloadItems(items);
    } else if (button.dataset.selectionAction === "move") {
      await moveItems(items);
    } else if (button.dataset.selectionAction === "delete") {
      await deleteItems(items);
    }
  }

  function showContextMenu(item, anchor) {
    state.contextItem = item;
    const buttons = Array.from(elements.contextMenu.querySelectorAll("[data-item-action]"));
    buttons.forEach((button) => {
      const action = button.dataset.itemAction;
      if (state.view === "recycle") {
        button.hidden = !["open", "delete"].includes(action);
        if (action === "open") button.textContent = "恢复";
        if (action === "delete") button.textContent = "永久删除";
      } else {
        button.hidden = false;
        if (action === "open") button.textContent = item.directory ? "打开" : "预览";
        button.disabled = action === "rename" && state.view === "recent";
      }
    });
    elements.contextMenu.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const menuWidth = 154;
    const estimatedHeight = state.view === "recycle" ? 88 : 198;
    const left = Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8);
    const top = Math.min(rect.bottom + 4, window.innerHeight - estimatedHeight - 8);
    elements.contextMenu.style.left = `${Math.max(8, left)}px`;
    elements.contextMenu.style.top = `${Math.max(8, top)}px`;
  }

  function hideContextMenu() {
    elements.contextMenu.hidden = true;
    state.contextItem = null;
  }

  async function handleContextAction(event) {
    const button = event.target.closest("[data-item-action]");
    if (!button || !state.contextItem) return;
    const item = state.contextItem;
    const action = button.dataset.itemAction;
    hideContextMenu();
    if (state.view === "recycle") {
      if (action === "open") await restoreRecycleItems([item]);
      if (action === "delete") await purgeRecycleItems([item]);
      return;
    }
    if (action === "open") openItem(item);
    if (action === "download") await downloadItems([item]);
    if (action === "rename") await renameItem(item);
    if (action === "move") await moveItems([item]);
    if (action === "delete") await deleteItems([item]);
  }

  function navigateToPath(path) {
    state.currentPath = path;
    state.view = "files";
    state.query = "";
    elements.searchInput.value = "";
    elements.clearSearch.hidden = true;
    state.selected.clear();
    updateViewChrome();
    loadCurrentView();
  }

  function openItem(item) {
    if (state.view === "recycle") return;
    if (item.directory) {
      navigateToPath(item.path);
    } else {
      openPreview(item);
    }
  }

  async function createFolder() {
    const values = await openFormDialog({
      eyebrow: "当前文件夹",
      title: "新建文件夹",
      description: state.currentPath ? `将在“${baseName(state.currentPath)}”中新建。` : "将在共享根目录中新建。",
      submitText: "新建",
      fields: [{ name: "name", label: "文件夹名称", type: "text", required: true, autofocus: true, maxlength: 120 }]
    });
    if (!values) return;
    const name = cleanName(values.name);
    if (!name) return showToast("请输入有效的文件夹名称。", "error");
    try {
      await NasApi.json("/api/files/folder", { method: "POST", body: { path: state.currentPath, name } });
      showToast("文件夹已新建。", "success");
      await loadCurrentView();
    } catch (error) {
      handleApiError(error);
    }
  }

  async function renameItem(item) {
    const values = await openFormDialog({
      eyebrow: "文件操作",
      title: "重命名",
      description: `为“${item.name}”输入新名称。`,
      submitText: "重命名",
      fields: [
        { name: "newName", label: "新名称", type: "text", required: true, value: item.name, autofocus: true, maxlength: 220 },
        { name: "conflict", label: "遇到同名项目时", type: "select", value: "rename", options: [{ value: "rename", label: "自动添加序号" }, { value: "overwrite", label: "覆盖同名项目" }, { value: "cancel", label: "取消操作" }] }
      ]
    });
    if (!values) return;
    const newName = cleanName(values.newName);
    if (!newName) return showToast("请输入有效的新名称。", "error");
    try {
      await NasApi.json("/api/files/rename", {
        method: "POST",
        body: { path: item.path, newName, conflict: values.conflict }
      });
      showToast("重命名完成。", "success");
      await loadCurrentView();
    } catch (error) {
      handleApiError(error);
    }
  }

  async function moveItems(items) {
    if (!items.length) return;
    const values = await openFormDialog({
      eyebrow: "文件操作",
      title: `移动 ${items.length} 项`,
      description: "目标路径从共享根目录开始填写；根目录请留空。",
      submitText: "移动",
      fields: [
        { name: "destination", label: "目标文件夹", type: "text", value: parentPath(items[0].path), placeholder: "例如：照片/2026", autofocus: true, help: "使用 / 分隔文件夹，不要填写 Windows 盘符。" },
        { name: "conflict", label: "遇到同名项目时", type: "select", value: "rename", options: [{ value: "rename", label: "自动添加序号" }, { value: "overwrite", label: "覆盖同名项目" }, { value: "cancel", label: "取消操作" }] }
      ]
    });
    if (!values) return;
    let destination;
    try {
      destination = cleanRelativePath(values.destination);
    } catch (error) {
      showToast(error.message, "error");
      return;
    }
    try {
      await NasApi.json("/api/files/move", {
        method: "POST",
        body: { paths: items.map((item) => item.path), destination, conflict: values.conflict }
      });
      showToast(`已移动 ${items.length} 项。`, "success");
      await loadCurrentView();
    } catch (error) {
      handleApiError(error);
    }
  }

  async function deleteItems(items) {
    if (!items.length) return;
    const values = await openFormDialog({
      eyebrow: "移入回收站",
      title: `删除 ${items.length} 项？`,
      description: items.length === 1 ? `“${items[0].name}”将移入回收站，可在 30 天内恢复。` : "所选文件将移入回收站，可在 30 天内恢复。",
      submitText: "移入回收站",
      danger: true,
      fields: []
    });
    if (!values) return;
    try {
      await NasApi.json("/api/files/delete", { method: "POST", body: { paths: items.map((item) => item.path) } });
      showToast(`已将 ${items.length} 项移入回收站。`, "success");
      await loadCurrentView();
    } catch (error) {
      handleApiError(error);
    }
  }

  async function restoreRecycleItems(items) {
    if (!items.length) return;
    const values = await openFormDialog({
      eyebrow: "回收站",
      title: `恢复 ${items.length} 项`,
      description: "文件将恢复到删除前的位置。",
      submitText: "恢复",
      fields: [{ name: "conflict", label: "原位置存在同名项目时", type: "select", value: "rename", options: [{ value: "rename", label: "自动添加序号" }, { value: "overwrite", label: "覆盖同名项目" }] }]
    });
    if (!values) return;
    try {
      await NasApi.json("/api/recycle/restore", {
        method: "POST",
        body: { ids: items.map((item) => item.id), conflict: values.conflict }
      });
      showToast(`已恢复 ${items.length} 项。`, "success");
      await loadCurrentView();
    } catch (error) {
      handleApiError(error);
    }
  }

  async function purgeRecycleItems(items) {
    if (!items.length) return;
    const values = await requestAdminConfirmation({
      title: `永久删除 ${items.length} 项？`,
      description: "此操作无法撤销，文件内容将被永久删除。",
      submitText: "永久删除"
    });
    if (!values) return;
    try {
      await NasApi.json("/api/recycle/purge", {
        method: "POST",
        body: { ids: items.map((item) => item.id), adminPassword: values.adminPassword, confirm: true }
      });
      showToast(`已永久删除 ${items.length} 项。`, "success");
      await loadCurrentView();
    } catch (error) {
      handleApiError(error);
    }
  }

  async function emptyRecycleBin() {
    const values = await requestAdminConfirmation({
      title: "清空回收站？",
      description: "回收站中的所有文件都将永久删除，此操作无法撤销。",
      submitText: "清空回收站"
    });
    if (!values) return;
    try {
      await NasApi.json("/api/recycle/empty", {
        method: "POST",
        body: { adminPassword: values.adminPassword, confirm: true }
      });
      showToast("回收站已清空。", "success");
      await loadCurrentView();
    } catch (error) {
      handleApiError(error);
    }
  }

  function requestAdminConfirmation(config) {
    return openFormDialog({
      eyebrow: "需要管理员验证",
      title: config.title,
      description: config.description,
      submitText: config.submitText,
      danger: true,
      fields: [
        { name: "adminPassword", label: "管理员密码", type: "password", required: true, autocomplete: "current-password", autofocus: true },
        { name: "confirmed", label: `我确认要${config.submitText}`, type: "checkbox", required: true }
      ]
    });
  }

  async function downloadItems(items) {
    if (!items.length) return;
    if (items.length === 1 && !items[0].directory) {
      const anchor = document.createElement("a");
      anchor.href = apiUrl("/api/files/download", { path: items[0].path });
      anchor.download = items[0].name;
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return;
    }
    await downloadZip(items);
  }

  async function downloadZip(items) {
    showToast("正在准备 ZIP 下载…");
    try {
      let fileHandle = null;
      if ("showSaveFilePicker" in window && window.isSecureContext) {
        try {
          fileHandle = await window.showSaveFilePicker({
            suggestedName: `家庭NAS-${new Date().toISOString().slice(0, 10)}.zip`,
            types: [{ description: "ZIP 压缩包", accept: { "application/zip": [".zip"] } }]
          });
        } catch (error) {
          if (error.name === "AbortError") return;
          fileHandle = null;
        }
      }
      const result = await NasApi.request("/api/files/download-zip", {
        method: "POST",
        body: { paths: items.map((item) => item.path) }
      });
      const filename = filenameFromHeaders(result.response) || "家庭NAS文件.zip";
      if (fileHandle && result.response.body) {
        const writable = await fileHandle.createWritable();
        await result.response.body.pipeTo(writable);
      } else {
        const blob = await result.response.blob();
        saveBlob(blob, filename);
      }
      showToast("ZIP 下载已开始。", "success");
    } catch (error) {
      handleApiError(error);
    }
  }

  function filenameFromHeaders(response) {
    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="?([^";]+)"?/i);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch (error) {
      return match[1];
    }
  }

  function saveBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  function uploadFiles(files) {
    if (!files.length || state.view !== "files") return;
    elements.uploadPanel.hidden = false;
    files.forEach((file) => startUpload(file, state.currentPath));
    updateUploadSummary();
  }

  function startUpload(file, destination) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const record = { id, file, destination, status: "uploading", progress: 0, xhr: null };
    state.uploads.set(id, record);
    const itemElement = createUploadItem(record);
    elements.uploadItems.prepend(itemElement);

    const xhr = new XMLHttpRequest();
    record.xhr = xhr;
    xhr.open("POST", "/api/files/upload");
    xhr.withCredentials = true;
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      record.progress = Math.round((event.loaded / event.total) * 100);
      updateUploadItem(record);
    });
    xhr.addEventListener("load", async () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch (error) {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && (!data || data.ok !== false)) {
        record.status = "complete";
        record.progress = 100;
        updateUploadItem(record);
        updateUploadSummary();
        if (state.view === "files" && state.currentPath === destination) await loadCurrentView();
      } else {
        record.status = "error";
        record.message = data && data.message ? data.message : uploadStatusMessage(xhr.status);
        updateUploadItem(record);
        updateUploadSummary();
        if (xhr.status === 401) redirectToLogin();
      }
    });
    xhr.addEventListener("error", () => {
      record.status = "error";
      record.message = "网络连接中断。";
      updateUploadItem(record);
      updateUploadSummary();
    });
    xhr.addEventListener("abort", () => {
      record.status = "cancelled";
      record.message = "已取消";
      updateUploadItem(record);
      updateUploadSummary();
    });
    const formData = new FormData();
    formData.append("files", file, file.name);
    formData.append("path", destination);
    formData.append("conflict", "rename");
    xhr.send(formData);
  }

  function createUploadItem(record) {
    const item = document.createElement("div");
    item.className = "upload-item";
    item.dataset.uploadId = record.id;
    const name = document.createElement("div");
    name.className = "upload-item-name";
    name.title = record.file.name;
    name.textContent = record.file.name;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "upload-cancel";
    cancel.setAttribute("aria-label", `取消上传 ${record.file.name}`);
    cancel.textContent = "×";
    cancel.addEventListener("click", () => {
      if (record.status === "uploading") record.xhr.abort();
      else {
        state.uploads.delete(record.id);
        item.remove();
        updateUploadSummary();
        if (!state.uploads.size) elements.uploadPanel.hidden = true;
      }
    });
    const status = document.createElement("div");
    status.className = "upload-item-status";
    const progress = document.createElement("div");
    progress.className = "upload-progress";
    progress.appendChild(document.createElement("span"));
    item.append(name, cancel, status, progress);
    return item;
  }

  function updateUploadItem(record) {
    const item = elements.uploadItems.querySelector(`[data-upload-id="${record.id}"]`);
    if (!item) return;
    const status = item.querySelector(".upload-item-status");
    const cancel = item.querySelector(".upload-cancel");
    item.classList.toggle("is-complete", record.status === "complete");
    item.classList.toggle("is-error", record.status === "error");
    item.querySelector(".upload-progress span").style.width = `${record.progress}%`;
    if (record.status === "uploading") status.textContent = `${record.progress}% · ${formatBytes(record.file.size)}`;
    if (record.status === "complete") status.textContent = "上传完成";
    if (record.status === "error") status.textContent = record.message || "上传失败";
    if (record.status === "cancelled") status.textContent = "已取消";
    cancel.textContent = record.status === "uploading" ? "×" : "移除";
    if (record.status !== "uploading") cancel.style.width = "48px";
  }

  function updateUploadSummary() {
    const uploads = Array.from(state.uploads.values());
    const active = uploads.filter((record) => record.status === "uploading").length;
    const complete = uploads.filter((record) => record.status === "complete").length;
    const failed = uploads.filter((record) => ["error", "cancelled"].includes(record.status)).length;
    elements.uploadTitle.textContent = active ? `正在上传 ${active} 项` : "上传任务";
    elements.uploadSummary.textContent = `${complete} 项完成${failed ? `，${failed} 项未完成` : ""}`;
  }

  function uploadStatusMessage(status) {
    if (status === 409) return "存在同名项目，上传未完成。";
    if (status === 413) return "文件过大，服务器已拒绝上传。";
    if (status === 401) return "登录已失效。";
    return "上传失败，请重试。";
  }

  async function openPreview(item) {
    if (state.previewItem) cleanupPreview();
    state.previewItem = item;
    elements.previewTitle.textContent = item.name;
    elements.previewMeta.textContent = `${kindLabels[item.kind] || "文件"} · ${formatBytes(item.size)} · ${formatDate(item.modifiedAt)}`;
    elements.previewBody.replaceChildren(createPreviewLoading());
    elements.previewDialog.showModal();
    try {
      if (item.kind === "image") {
        renderImagePreview(item);
      } else if (item.kind === "video") {
        renderVideoPreview(item);
      } else if (item.kind === "pdf") {
        await renderPdfPreview(item);
      } else if (item.kind === "text") {
        await renderTextPreview(item);
      } else if (item.kind === "document" || item.kind === "sheet") {
        await renderMetadataPreview(item);
      } else {
        renderUnsupportedPreview(item);
      }
    } catch (error) {
      renderPreviewError(error.message);
    }
  }

  function createPreviewLoading() {
    const panel = document.createElement("div");
    panel.className = "preview-message";
    const spinner = document.createElement("span");
    spinner.className = "large-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const text = document.createElement("p");
    text.textContent = "正在准备预览…";
    panel.append(spinner, text);
    return panel;
  }

  function renderImagePreview(item) {
    const image = document.createElement("img");
    image.alt = item.name;
    image.src = apiUrl("/api/files/stream", { path: item.path });
    image.addEventListener("error", () => renderPreviewError("图片无法显示，文件可能已损坏或格式不受浏览器支持。"));
    elements.previewBody.replaceChildren(image);
  }

  function renderVideoPreview(item, forceAttempt) {
    const extension = extensionOf(item.name);
    if (extension === "flv") {
      renderFlvPreview(item);
      return;
    }
    if (!forceAttempt && ["mkv", "avi", "hevc"].includes(extension)) {
      const message = createPreviewMessage("此视频可能无法播放", "浏览器通常不支持 MKV、AVI 或 HEVC 解码。可以尝试播放，或直接下载后使用本地播放器打开。");
      const attempt = document.createElement("button");
      attempt.type = "button";
      attempt.className = "button button-primary";
      attempt.textContent = "仍然尝试播放";
      attempt.addEventListener("click", () => renderVideoPreview(item, true));
      message.appendChild(attempt);
      elements.previewBody.replaceChildren(message);
      return;
    }
    const video = document.createElement("video");
    video.controls = true;
    video.autoplay = false;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = apiUrl("/api/files/stream", { path: item.path });
    video.addEventListener("error", () => {
      const message = createPreviewMessage("浏览器无法播放此视频", "视频编码可能不受当前浏览器支持。请下载后使用本地播放器打开。");
      const download = document.createElement("button");
      download.type = "button";
      download.className = "button button-primary";
      download.textContent = "下载视频";
      download.addEventListener("click", () => downloadItems([item]));
      message.appendChild(download);
      elements.previewBody.replaceChildren(message);
    }, { once: true });
    elements.previewBody.replaceChildren(video);
  }

  function renderFlvPreview(item) {
    if (!window.flvjs || !window.flvjs.isSupported()) {
      renderPreviewError("当前浏览器不支持 FLV 播放所需的 Media Source Extensions，请下载后使用本地播放器打开。");
      return;
    }

    const video = document.createElement("video");
    video.controls = true;
    video.autoplay = false;
    video.playsInline = true;
    video.preload = "metadata";
    elements.previewBody.replaceChildren(video);

    const player = window.flvjs.createPlayer({
      type: "flv",
      url: apiUrl("/api/files/stream", { path: item.path }),
      isLive: false,
      hasAudio: true,
      hasVideo: true
    }, {
      enableWorker: false,
      lazyLoad: true,
      stashInitialSize: 384 * 1024
    });
    state.flvPlayer = player;
    player.on(window.flvjs.Events.ERROR, () => {
      if (state.flvPlayer !== player) return;
      player.destroy();
      state.flvPlayer = null;
      renderPreviewError("FLV 文件无法播放。当前仅支持浏览器可解码的 H.264 视频及 AAC/MP3 音频编码，请下载后使用本地播放器打开。");
    });
    player.attachMediaElement(video);
    player.load();
  }

  async function loadPdfModule() {
    if (!state.pdfModulePromise) {
      state.pdfModulePromise = import("./vendor/pdfjs/pdf.min.mjs").then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";
        return pdfjs;
      });
    }
    return state.pdfModulePromise;
  }

  async function renderPdfPreview(item) {
    const viewer = document.createElement("section");
    viewer.className = "pdf-viewer";
    viewer.setAttribute("aria-label", `${item.name} PDF 预览`);

    const toolbar = document.createElement("div");
    toolbar.className = "pdf-toolbar";
    const previous = createPdfButton("上一页", "上一页");
    const pageLabel = document.createElement("span");
    pageLabel.className = "pdf-page-label";
    const next = createPdfButton("下一页", "下一页");
    const zoomOut = createPdfButton("缩小", "－");
    const zoomIn = createPdfButton("放大", "＋");
    toolbar.append(previous, pageLabel, next, zoomOut, zoomIn);

    const stage = document.createElement("div");
    stage.className = "pdf-stage";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", "PDF 页面");
    stage.appendChild(canvas);
    viewer.append(toolbar, stage);
    elements.previewBody.replaceChildren(viewer);

    let pdfjs;
    try {
      pdfjs = await loadPdfModule();
    } catch {
      renderPreviewError("PDF 渲染组件加载失败，请更新平板浏览器后重试。");
      return;
    }
    if (state.previewItem !== item) return;
    const loadingTask = pdfjs.getDocument({
      url: apiUrl("/api/files/stream", { path: item.path }),
      cMapUrl: "./vendor/pdfjs/cmaps/",
      cMapPacked: true,
      iccUrl: "./vendor/pdfjs/iccs/",
      standardFontDataUrl: "./vendor/pdfjs/standard_fonts/",
      wasmUrl: "./vendor/pdfjs/wasm/",
      enableXfa: true,
      isEvalSupported: false
    });
    state.pdfLoadingTask = loadingTask;

    try {
      const documentProxy = await loadingTask.promise;
      if (state.previewItem !== item) {
        await documentProxy.destroy();
        return;
      }
      state.pdfDocument = documentProxy;
      state.pdfPage = 1;
      state.pdfZoom = 1;

      const renderCurrentPage = async () => {
        if (!state.pdfDocument || state.previewItem !== item) return;
        if (state.pdfRenderTask) {
          state.pdfRenderTask.cancel();
          state.pdfRenderTask = null;
        }
        const page = await state.pdfDocument.getPage(state.pdfPage);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(280, stage.clientWidth - 32);
        const fitScale = Math.min(1.6, availableWidth / baseViewport.width);
        const viewport = page.getViewport({ scale: fitScale * state.pdfZoom });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        pageLabel.textContent = `${state.pdfPage} / ${state.pdfDocument.numPages}`;
        previous.disabled = state.pdfPage <= 1;
        next.disabled = state.pdfPage >= state.pdfDocument.numPages;
        zoomOut.disabled = state.pdfZoom <= 0.6;
        zoomIn.disabled = state.pdfZoom >= 2.4;
        const renderTask = page.render({
          canvas,
          viewport,
          transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
        });
        state.pdfRenderTask = renderTask;
        try {
          await renderTask.promise;
        } catch (error) {
          if (error?.name !== "RenderingCancelledException") throw error;
        } finally {
          if (state.pdfRenderTask === renderTask) state.pdfRenderTask = null;
        }
      };

      previous.addEventListener("click", () => {
        if (state.pdfPage <= 1) return;
        state.pdfPage -= 1;
        renderCurrentPage().catch((error) => renderPreviewError(error.message));
      });
      next.addEventListener("click", () => {
        if (state.pdfPage >= state.pdfDocument.numPages) return;
        state.pdfPage += 1;
        renderCurrentPage().catch((error) => renderPreviewError(error.message));
      });
      zoomOut.addEventListener("click", () => {
        state.pdfZoom = Math.max(0.6, Number((state.pdfZoom - 0.2).toFixed(1)));
        renderCurrentPage().catch((error) => renderPreviewError(error.message));
      });
      zoomIn.addEventListener("click", () => {
        state.pdfZoom = Math.min(2.4, Number((state.pdfZoom + 0.2).toFixed(1)));
        renderCurrentPage().catch((error) => renderPreviewError(error.message));
      });
      await renderCurrentPage();
      if ("ResizeObserver" in window) {
        let previousWidth = stage.clientWidth;
        let resizeTimer = null;
        state.pdfResizeObserver = new ResizeObserver(() => {
          const currentWidth = stage.clientWidth;
          if (Math.abs(currentWidth - previousWidth) < 20) return;
          previousWidth = currentWidth;
          window.clearTimeout(resizeTimer);
          resizeTimer = window.setTimeout(() => {
            renderCurrentPage().catch((error) => renderPreviewError(error.message));
          }, 120);
        });
        state.pdfResizeObserver.observe(stage);
      }
    } catch (error) {
      if (state.previewItem !== item || error?.name === "AbortException") return;
      const message = error?.name === "PasswordException"
        ? "此 PDF 受密码保护，当前无法在线预览，请下载后打开。"
        : "PDF 加载失败，文件可能已损坏或格式不受支持。";
      renderPreviewError(message);
    }
  }

  function createPdfButton(label, text) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button pdf-tool-button";
    button.setAttribute("aria-label", label);
    button.textContent = text;
    return button;
  }

  async function renderTextPreview(item) {
    const data = await NasApi.json(apiUrl("/api/files/text", { path: item.path }));
    const documentView = document.createElement("div");
    documentView.className = "preview-document";
    if (data.truncated) {
      const notice = document.createElement("p");
      notice.className = "muted-text";
      notice.textContent = "文件较大，仅显示部分内容。";
      documentView.appendChild(notice);
    }
    const pre = document.createElement("pre");
    pre.textContent = String(data.content || "");
    documentView.appendChild(pre);
    elements.previewBody.replaceChildren(documentView);
  }

  async function renderMetadataPreview(item) {
    const data = await NasApi.json(apiUrl("/api/files/meta", { path: item.path }));
    const preview = data.preview ?? (data.meta && data.meta.preview);
    if (preview === undefined || preview === null) {
      renderPreviewError("服务器未生成此文件的预览，可下载后使用本地应用打开。");
      return;
    }
    const documentView = document.createElement("div");
    documentView.className = "preview-document";
    if (extensionOf(item.name) === "docx") {
      const notice = document.createElement("p");
      notice.className = "document-preview-notice";
      notice.textContent = "在线预览用于阅读，复杂排版可能与原始 Word 文件略有差异。";
      documentView.appendChild(notice);
    }
    appendStructuredPreview(documentView, preview, item.kind);
    elements.previewBody.replaceChildren(documentView);
  }

  function appendStructuredPreview(container, preview, kind) {
    if (typeof preview === "string") {
      if (/<[a-z][\s\S]*>/i.test(preview)) {
        container.appendChild(sanitizePreviewHtml(preview));
      } else {
        const pre = document.createElement(kind === "document" ? "div" : "pre");
        pre.textContent = preview;
        container.appendChild(pre);
      }
      return;
    }
    if (Array.isArray(preview)) {
      if (preview.every(Array.isArray)) {
        container.appendChild(createPreviewTable(preview));
      } else {
        preview.forEach((entry) => {
          const paragraph = document.createElement("p");
          paragraph.textContent = typeof entry === "string" ? entry : JSON.stringify(entry);
          container.appendChild(paragraph);
        });
      }
      return;
    }
    if (preview && typeof preview === "object") {
      if (preview.truncated) {
        const notice = document.createElement("p");
        notice.className = "muted-text";
        notice.textContent = kind === "sheet" ? "表格较大，仅显示前 500 行、50 列。" : "文档较大，仅显示部分内容。";
        container.appendChild(notice);
      }
      if (typeof preview.html === "string") {
        container.appendChild(sanitizePreviewHtml(preview.html));
        return;
      }
      if (typeof preview.text === "string") {
        const pre = document.createElement("pre");
        pre.textContent = preview.text;
        container.appendChild(pre);
        return;
      }
      if (Array.isArray(preview.paragraphs)) {
        preview.paragraphs.forEach((text) => {
          const paragraph = document.createElement("p");
          paragraph.textContent = String(text);
          container.appendChild(paragraph);
        });
        return;
      }
      const sheet = Array.isArray(preview.sheets) ? preview.sheets[0] : null;
      const rows = preview.rows || preview.data || (sheet && (sheet.rows || sheet.data));
      const sheetName = preview.activeSheet || (sheet && sheet.name);
      if (sheetName) {
        const heading = document.createElement("h3");
        heading.textContent = String(sheetName);
        container.appendChild(heading);
      }
      if (Array.isArray(rows)) {
        container.appendChild(createPreviewTable(rows));
        return;
      }
    }
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(preview, null, 2);
    container.appendChild(pre);
  }

  function createPreviewTable(rows) {
    const table = document.createElement("table");
    const body = document.createElement("tbody");
    rows.forEach((row, rowIndex) => {
      const rowElement = document.createElement("tr");
      const cells = Array.isArray(row) ? row : Object.values(row || {});
      cells.forEach((value) => {
        const cell = document.createElement(rowIndex === 0 ? "th" : "td");
        cell.textContent = value === null || value === undefined ? "" : String(value);
        rowElement.appendChild(cell);
      });
      body.appendChild(rowElement);
    });
    table.appendChild(body);
    return table;
  }

  function sanitizePreviewHtml(html) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const fragment = document.createDocumentFragment();
    const allowed = new Set(["P", "BR", "DIV", "SPAN", "STRONG", "B", "EM", "I", "U", "S", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "BLOCKQUOTE", "PRE", "CODE", "IMG"]);

    function cloneSafe(node) {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || "");
      if (node.nodeType !== Node.ELEMENT_NODE || !allowed.has(node.tagName)) {
        const safeFragment = document.createDocumentFragment();
        Array.from(node.childNodes || []).forEach((child) => safeFragment.appendChild(cloneSafe(child)));
        return safeFragment;
      }
      const clone = document.createElement(node.tagName.toLowerCase());
      if (["TD", "TH"].includes(node.tagName)) {
        ["colspan", "rowspan"].forEach((attribute) => {
          const value = Number(node.getAttribute(attribute));
          if (Number.isInteger(value) && value > 1 && value <= 100) clone.setAttribute(attribute, String(value));
        });
      }
      if (node.tagName === "IMG") {
        const source = node.getAttribute("src") || "";
        if (/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(source)) {
          clone.setAttribute("src", source);
          clone.setAttribute("alt", node.getAttribute("alt") || "Word 文档图片");
        }
      }
      Array.from(node.childNodes).forEach((child) => clone.appendChild(cloneSafe(child)));
      return clone;
    }

    Array.from(parsed.body.childNodes).forEach((node) => fragment.appendChild(cloneSafe(node)));
    return fragment;
  }

  function renderUnsupportedPreview(item) {
    const message = createPreviewMessage("暂不支持在线预览", "此文件类型无法在浏览器中预览，请下载后使用本地应用打开。");
    const download = document.createElement("button");
    download.type = "button";
    download.className = "button button-primary";
    download.textContent = "下载文件";
    download.addEventListener("click", () => downloadItems([item]));
    message.appendChild(download);
    elements.previewBody.replaceChildren(message);
  }

  function renderPreviewError(messageText) {
    const message = createPreviewMessage("预览失败", messageText || "无法读取此文件。");
    if (state.previewItem) {
      const download = document.createElement("button");
      download.type = "button";
      download.className = "button";
      download.textContent = "下载文件";
      download.addEventListener("click", () => downloadItems([state.previewItem]));
      message.appendChild(download);
    }
    elements.previewBody.replaceChildren(message);
  }

  function createPreviewMessage(titleText, bodyText) {
    const message = document.createElement("div");
    message.className = "preview-message";
    const icon = document.createElement("div");
    icon.className = "state-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "▱";
    const title = document.createElement("h3");
    title.textContent = titleText;
    const body = document.createElement("p");
    body.textContent = bodyText;
    message.append(icon, title, body);
    return message;
  }

  function cleanupPreview() {
    if (state.pdfResizeObserver) {
      state.pdfResizeObserver.disconnect();
      state.pdfResizeObserver = null;
    }
    if (state.pdfRenderTask) {
      state.pdfRenderTask.cancel();
      state.pdfRenderTask = null;
    }
    if (state.pdfLoadingTask) {
      state.pdfLoadingTask.destroy();
      state.pdfLoadingTask = null;
    } else if (state.pdfDocument) {
      state.pdfDocument.destroy();
    }
    state.pdfDocument = null;
    state.pdfPage = 1;
    state.pdfZoom = 1;
    if (state.flvPlayer) {
      state.flvPlayer.destroy();
      state.flvPlayer = null;
    }
    const video = elements.previewBody.querySelector("video");
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    elements.previewBody.replaceChildren();
    state.previewItem = null;
  }

  async function loadStatus() {
    elements.statusLoading.hidden = false;
    elements.statusContent.hidden = true;
    try {
      const data = await NasApi.json("/api/system/status");
      const disk = data.disk || data.storage || {};
      const total = Number(disk.total ?? data.diskTotal ?? 0) || 0;
      const free = Number(disk.free ?? disk.available ?? data.diskFree ?? 0) || 0;
      const used = Number(disk.used ?? data.diskUsed ?? Math.max(0, total - free)) || 0;
      const percent = total ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;
      const addresses = data.addresses || data.urls || data.localUrls || data.ips || data.ip || "—";
      const addressText = Array.isArray(addresses)
        ? addresses.map((entry) => typeof entry === "object" && entry ? (entry.url || entry.address || "") : String(entry)).filter(Boolean).join("、")
        : String(addresses);
      elements.statusRoot.textContent = data.shareRoot || data.sharedRoot || data.rootPath || data.path || "—";
      elements.statusPort.textContent = data.port ? String(data.port) : "—";
      elements.statusAddresses.textContent = addressText || "—";
      elements.statusVersion.textContent = String(data.version || data.appVersion || "—");
      elements.storageUsed.textContent = total ? `已使用 ${formatBytes(used)}` : "空间信息不可用";
      elements.storageTotal.textContent = total ? `共 ${formatBytes(total)}` : "—";
      elements.storageFree.textContent = total ? `剩余 ${formatBytes(free)}（${Math.round(100 - percent)}%）` : "服务器未返回磁盘容量";
      elements.storageBarFill.style.width = `${percent}%`;
      elements.storageBarFill.parentElement.setAttribute("aria-valuenow", String(Math.round(percent)));
      const firewall = data.firewall || data.firewallWarning || data.firewallMessage || data.firewallHint;
      const firewallText = typeof firewall === "object" ? (firewall.message || firewall.warning || "") : String(firewall || "");
      elements.firewallCard.hidden = !firewallText;
      elements.firewallMessage.textContent = firewallText;
      elements.statusLoading.hidden = true;
      elements.statusContent.hidden = false;
    } catch (error) {
      elements.statusLoading.textContent = error.message;
      handleApiError(error);
    }
  }

  function openFormDialog(config) {
    if (elements.formDialog.open) elements.formDialog.close();
    elements.dialogEyebrow.textContent = config.eyebrow || "";
    elements.dialogTitle.textContent = config.title || "确认操作";
    elements.dialogDescription.textContent = config.description || "";
    elements.dialogDescription.hidden = !config.description;
    elements.dialogError.textContent = "";
    elements.dialogSubmit.textContent = config.submitText || "确定";
    elements.dialogSubmit.classList.toggle("button-danger", Boolean(config.danger));
    elements.dialogSubmit.classList.toggle("button-primary", !config.danger);
    elements.dialogFields.replaceChildren(...(config.fields || []).map(createDialogField));
    elements.formDialog.showModal();
    const autofocus = elements.dialogFields.querySelector("[autofocus]");
    if (autofocus) setTimeout(() => {
      autofocus.focus();
      if (autofocus.select) autofocus.select();
    }, 0);
    return new Promise((resolve) => {
      state.dialogResolve = resolve;
    });
  }

  function createDialogField(field) {
    const wrap = document.createElement("div");
    wrap.className = field.type === "checkbox" ? "confirm-check" : "dialog-field";
    const id = `dialog-${field.name}`;
    const input = field.type === "select" ? document.createElement("select") : document.createElement("input");
    input.id = id;
    input.name = field.name;
    input.required = Boolean(field.required);
    if (field.autofocus) input.autofocus = true;
    if (field.type === "select") {
      (field.options || []).forEach((option) => {
        const optionElement = document.createElement("option");
        optionElement.value = option.value;
        optionElement.textContent = option.label;
        optionElement.selected = option.value === field.value;
        input.appendChild(optionElement);
      });
    } else {
      input.type = field.type || "text";
      if (field.value !== undefined) input.value = field.value;
      if (field.placeholder) input.placeholder = field.placeholder;
      if (field.maxlength) input.maxLength = field.maxlength;
      if (field.autocomplete) input.autocomplete = field.autocomplete;
    }
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = field.label;
    if (field.type === "checkbox") wrap.append(input, label);
    else wrap.append(label, input);
    if (field.help) {
      const help = document.createElement("small");
      help.textContent = field.help;
      wrap.appendChild(help);
    }
    return wrap;
  }

  function submitFormDialog(event) {
    event.preventDefault();
    if (!elements.dialogForm.reportValidity()) return;
    const data = {};
    new FormData(elements.dialogForm).forEach((value, key) => {
      data[key] = value;
    });
    elements.dialogFields.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
      data[checkbox.name] = checkbox.checked;
    });
    const requiredCheckbox = elements.dialogFields.querySelector("input[type='checkbox'][required]");
    if (requiredCheckbox && !requiredCheckbox.checked) {
      elements.dialogError.textContent = "请先勾选确认项。";
      return;
    }
    const resolve = state.dialogResolve;
    state.dialogResolve = null;
    elements.formDialog.close();
    if (resolve) resolve(data);
  }

  function closeFormDialog() {
    const resolve = state.dialogResolve;
    state.dialogResolve = null;
    elements.formDialog.close();
    if (resolve) resolve(null);
  }

  function cleanName(name) {
    const value = String(name || "").trim();
    if (!value || /[\\/:*?"<>|]/.test(value) || value === "." || value === "..") return "";
    return value;
  }

  function cleanRelativePath(path) {
    const value = String(path || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (/^[a-z]:/i.test(value) || value.split("/").some((segment) => segment === "..")) {
      throw new Error("目标路径必须位于共享目录内。");
    }
    return value.split("/").filter((segment) => segment && segment !== ".").join("/");
  }

  async function logout() {
    try {
      await NasApi.json("/api/auth/logout", { method: "POST" });
    } catch (error) {
      if (error.status !== 401) showToast(error.message, "error");
    } finally {
      redirectToLogin();
    }
  }

  function redirectToLogin() {
    window.location.replace("./login.html");
  }

  function handleApiError(error, asPageError) {
    if (error && error.status === 401) {
      redirectToLogin();
      return;
    }
    const message = error && error.message ? error.message : "操作失败，请稍后重试。";
    if (asPageError) showLoadError(message);
    else showToast(message, "error");
  }

  function showToast(message, type) {
    const toast = document.createElement("div");
    toast.className = `toast${type ? ` is-${type}` : ""}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = type === "error" ? "!" : type === "success" ? "✓" : "i";
    const text = document.createElement("span");
    text.textContent = message;
    toast.append(icon, text);
    elements.toastRegion.appendChild(toast);
    setTimeout(() => toast.remove(), type === "error" ? 6000 : 3500);
  }

  initialize();
}());
