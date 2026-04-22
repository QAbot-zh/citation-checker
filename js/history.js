/** ---------- 历史记录侧边栏 ---------- */
const HISTORY_ENABLED_KEY = "citation_checker_history_enabled";
const HISTORY_DATA_KEY = "citation_checker_history";
const HISTORY_COLLAPSED_KEY = "citation_checker_history_collapsed";
const MAX_HISTORY = 50;

/** ---------- localStorage 读写 ---------- */
function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_DATA_KEY) || "[]");
  } catch {
    return [];
  }
}

function setHistory(list) {
  localStorage.setItem(HISTORY_DATA_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
}

/** ---------- 保存当前校验记录 ---------- */
function saveToHistory(rawText, results) {
  const checkbox = document.getElementById("historyEnabled");
  if (!checkbox) return;
  if (!checkbox.checked) return;
  if (!rawText || !rawText.trim()) return;
  if (!results || results.length === 0) return;

  let serializedResults;
  try {
    serializedResults = JSON.parse(JSON.stringify(results));
  } catch {
    return;
  }

  const firstLine = rawText.split("\n").find((l) => l.trim()) || "";
  const firstTitle =
    serializedResults[0]?.parsed?.title || firstLine.slice(0, 40);

  const entry = {
    id: Date.now().toString(),
    timestamp: Date.now(),
    title:
      firstTitle + (serializedResults.length > 1 ? ` 等 ${serializedResults.length} 条` : ""),
    rawText,
    results: serializedResults,
    summary: {
      total: serializedResults.length,
      high: serializedResults.filter((r) => r.verdict?.level === "high").length,
      medium: serializedResults.filter((r) => r.verdict?.level === "medium").length,
      low: serializedResults.filter((r) => r.verdict?.level === "low").length,
    },
    isExtracted: window.extractedMode || false,
  };

  const list = getHistory();
  list.unshift(entry);
  setHistory(list);
  renderHistoryList();
}

/** ---------- 渲染历史列表 ---------- */
function renderHistoryList() {
  const list = getHistory();
  const container = document.getElementById("historyList");
  if (list.length === 0) {
    container.innerHTML = `
      <div class="history-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        <div>暂无历史记录</div>
      </div>`;
    return;
  }

  const groups = groupByDate(list);
  container.innerHTML = Object.entries(groups)
    .map(
      ([label, items]) => `
    <div class="history-date-group">${label}</div>
    ${items
      .map(
        (item) => `
      <div class="history-item ${item.pinned ? 'pinned' : ''}" data-id="${item.id}" onclick="loadHistoryEntry('${item.id}')">
        <div class="history-item-content">
          <div class="history-item-title-wrapper">
            <div class="history-item-title" id="history-title-${item.id}" ondblclick="startRename('${item.id}', event)">${esc(item.title)}</div>
          </div>
          <div class="history-item-meta">${item.summary.total}条 · ${formatTime(item.timestamp)}</div>
        </div>
        <div class="history-dropdown" onclick="event.stopPropagation()">
          <button class="history-dropdown-trigger" title="更多操作">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="12" cy="5" r="2"/>
              <circle cx="12" cy="12" r="2"/>
              <circle cx="12" cy="19" r="2"/>
            </svg>
          </button>
          <div class="history-dropdown-menu">
            <div class="history-dropdown-item ${item.pinned ? 'active' : ''}" onclick="pinHistoryEntry('${item.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2l-5.5 9h11L12 2z"/>
                <path d="M12 11v9"/>
                <path d="M8 20h8"/>
              </svg>
              ${item.pinned ? '取消置顶' : '置顶'}
            </div>
            <div class="history-dropdown-item" onclick="startRename('${item.id}', event)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              重命名
            </div>
            <div class="history-dropdown-divider"></div>
            <div class="history-dropdown-item danger" onclick="deleteHistoryEntry('${item.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              删除
            </div>
          </div>
        </div>
      </div>
    `,
      )
      .join("")}
  `,
    )
    .join("");
}

/** ---------- 重命名 ---------- */
let _renamingId = null;

function startRename(id, event) {
  event.stopPropagation();
  if (_renamingId) {
    finishRename();
  }
  _renamingId = id;

  const titleEl = document.getElementById(`history-title-${id}`);
  if (!titleEl) return;

  const currentTitle = titleEl.textContent;
  titleEl.innerHTML = `<input type="text" class="history-rename-input" value="${esc(currentTitle)}" onkeydown="handleRenameKey(event)" onblur="finishRename()" onclick="event.stopPropagation()">`;

  const input = titleEl.querySelector("input");
  input.focus();
  input.select();
}

function handleRenameKey(event) {
  if (event.key === "Enter") {
    finishRename();
  } else if (event.key === "Escape") {
    _renamingId = null;
    renderHistoryList();
  }
}

function finishRename() {
  if (!_renamingId) return;
  const input = document.querySelector(`#history-title-${_renamingId} input`);
  if (!input) {
    _renamingId = null;
    return;
  }

  const newTitle = input.value.trim();
  if (newTitle) {
    const list = getHistory();
    const entry = list.find((h) => h.id === _renamingId);
    if (entry) {
      entry.title = newTitle;
      setHistory(list);
    }
  }
  _renamingId = null;
  renderHistoryList();
}

/** ---------- 置顶 ---------- */
function pinHistoryEntry(id) {
  const list = getHistory();
  const index = list.findIndex((h) => h.id === id);
  if (index === -1) return;

  // 切换置顶状态
  const entry = list[index];
  entry.pinned = !entry.pinned;

  // 重新排序：置顶的在前，按时间倒序
  list.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.timestamp - a.timestamp;
  });

  setHistory(list);
  renderHistoryList();
}

/** ---------- 加载历史条目到主界面 ---------- */
function loadHistoryEntry(id) {
  const list = getHistory();
  const entry = list.find((h) => h.id === id);
  if (!entry) return;

  document.getElementById("citation").value = entry.rawText;
  citationFormatted = false;
  updateCitationCount();

  const resultsDiv = document.getElementById("results");
  if (entry.isExtracted) {
    resultsDiv.innerHTML = entry.results
      .map((r, i) => renderExtractedResult(r, i))
      .join("");
    window.extractedMode = true;
  } else {
    resultsDiv.innerHTML = entry.results
      .map((r, i) => renderResult(r, i))
      .join("");
    window.extractedMode = false;
  }

  window.currentResults = entry.results;
  document.getElementById("statTotal").textContent = entry.summary.total;
  document.getElementById("statHigh").textContent = entry.summary.high;
  document.getElementById("statMedium").textContent = entry.summary.medium;
  document.getElementById("statLow").textContent = entry.summary.low;
  document.getElementById("summary").classList.add("active");
  document.getElementById("exportSection").classList.add("active");

  exportMode = entry.isExtracted
    ? "all"
    : entry.summary.high > 0
      ? "high"
      : "all";
  document
    .querySelectorAll(".export-option")
    .forEach((o) => o.classList.remove("active"));
  document
    .querySelector(`.export-option[data-value='${exportMode}']`)
    ?.classList.add("active");
  updateExportTooltips();

  document
    .querySelectorAll(".history-item")
    .forEach((el) => el.classList.remove("active"));
  document.querySelector(`.history-item[data-id='${id}']`)?.classList.add("active");

  showToast("已加载历史记录");
}

/** ---------- 删除单条历史 ---------- */
function deleteHistoryEntry(id) {
  let list = getHistory();
  list = list.filter((h) => h.id !== id);
  setHistory(list);
  renderHistoryList();
}

/** ---------- 清空全部历史 ---------- */
function clearAllHistory() {
  if (!confirm("确定清空所有历史记录？")) return;
  localStorage.removeItem(HISTORY_DATA_KEY);
  renderHistoryList();
  showToast("已清空历史记录");
}

/** ---------- 新建检测 ---------- */
function startNewCheck() {
  document.getElementById("citation").value = "";
  document.getElementById("results").innerHTML = "";
  document.getElementById("summary").classList.remove("active");
  document.getElementById("exportSection").classList.remove("active");
  document.getElementById("progress").classList.remove("active");
  window.currentResults = [];
  window.extractedMode = false;
  citationFormatted = false;
  updateCitationCount();
  document
    .querySelectorAll(".history-item")
    .forEach((el) => el.classList.remove("active"));
}

/** ---------- 展开/收起侧边栏 ---------- */
function toggleHistoryPanel() {
  const sidebar = document.getElementById("historySidebar");
  const toggle = document.getElementById("historyToggle");
  const main = document.getElementById("mainContent");
  const isCollapsed = sidebar.classList.toggle("collapsed");
  toggle.classList.toggle("open", !isCollapsed);
  main.classList.toggle("with-sidebar", !isCollapsed);
  localStorage.setItem(HISTORY_COLLAPSED_KEY, isCollapsed ? "1" : "0");
}

/** ---------- 初始化侧边栏状态 ---------- */
function initHistoryPanel() {
  const sidebar = document.getElementById("historySidebar");
  const toggle = document.getElementById("historyToggle");
  const main = document.getElementById("mainContent");
  const isCollapsed = localStorage.getItem(HISTORY_COLLAPSED_KEY) === "1";

  if (isCollapsed) {
    sidebar.classList.add("collapsed");
  } else {
    toggle.classList.add("open");
    main.classList.add("with-sidebar");
  }

  const enabled = localStorage.getItem(HISTORY_ENABLED_KEY);
  document.getElementById("historyEnabled").checked = enabled !== "false";
}

/** ---------- 日期分组辅助函数 ---------- */
function groupByDate(list) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const groups = {};
  for (const item of list) {
    const d = new Date(item.timestamp);
    const itemDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    let label;
    if (itemDay.getTime() === today.getTime()) {
      label = "今天";
    } else if (itemDay.getTime() === yesterday.getTime()) {
      label = "昨天";
    } else {
      label = `${d.getMonth() + 1}月${d.getDate()}日`;
    }

    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  }
  return groups;
}

function formatTime(ts) {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

/** ---------- 事件监听 ---------- */
document.getElementById("historyEnabled")?.addEventListener("change", (e) => {
  localStorage.setItem(HISTORY_ENABLED_KEY, e.target.checked);
});

/** ---------- 初始化 ---------- */
initHistoryPanel();
renderHistoryList();
