/** ---------- 事件监听 & 初始化 ---------- */

// 引用输入框计数
document.getElementById("citation").addEventListener("input", () => {
  citationFormatted = false;
  clearTimeout(_citationCountTimer);
  _citationCountTimer = setTimeout(updateCitationCount, 300);
});


/** ---------- 主逻辑 ---------- */
document.getElementById("run").addEventListener("click", async () => {
  const btn = document.getElementById("run");
  const resultsDiv = document.getElementById("results");
  const progressDiv = document.getElementById("progress");
  const summaryDiv = document.getElementById("summary");

  const rawText = document.getElementById("citation").value;
  const mailto = document.getElementById("mailto").value.trim();

  // 解析多行，过滤空行
  const lines = smartSplitCitations(rawText);

  if (lines.length === 0) {
    resultsDiv.innerHTML = `
      <div class="card empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
        <div>请输入至少一条引用</div>
      </div>
    `;
    return;
  }

  // 重置UI
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.innerHTML = `<span class="loading-spinner"></span> 校验中...`;
  resultsDiv.innerHTML = "";
  summaryDiv.classList.remove("active");
  progressDiv.classList.add("active");
  updateProgress(0, lines.length, "准备中...");

  // 清除提取模式，校验完成后将使用校验结果生成 BibTeX
  window.extractedMode = false;

  // 获取并发数
  const concurrency =
    parseInt(document.getElementById("concurrency").value, 10) || 3;

  // 创建结果数组（保持顺序）
  const results = new Array(lines.length).fill(null);
  let completedCount = 0;

  // 先创建所有占位符（构串后一次性赋值，避免 innerHTML += 导致的 O(N²) 重解析）
  resultsDiv.innerHTML = lines
    .map(
      (line, i) => `
            <div class="processing-item" id="processing-${i}">
              <div class="processing-item-status">
                <span class="processing-item-status-dot"></span>
                <span id="status-${i}">等待处理</span>
              </div>
              <div class="processing-item-text">${esc(line.slice(0, 80))}${line.length > 80 ? "..." : ""}</div>
              <div class="processing-item-progress" id="progress-${i}" style="width: 0%"></div>
            </div>
          `,
    )
    .join("");

  // 更新条目状态和进度
  function updateItemStatus(index, status, progress) {
    const statusEl = document.getElementById(`status-${index}`);
    const progressEl = document.getElementById(`progress-${index}`);
    if (statusEl) statusEl.textContent = status;
    if (progressEl) progressEl.style.width = progress + "%";
  }

  // 并发处理函数
  async function processItem(index) {
    const line = lines[index];

    try {
      // 1. 解析阶段
      updateItemStatus(index, "解析中...", 25);
      const useAi = localStorage.getItem(AI_ENABLED_KEY) === "true";
      const useAiScoring = localStorage.getItem("aiScoringEnabled") === "true";
      let parsed;

      if (useAi) {
        // 尝试 AI 解析
        parsed = await parseWithAI(line);
        if (!parsed) {
          // AI 解析失败，回退到规则解析
          parsed = parseCitation(line);
        }
      } else {
        parsed = parseCitation(line);
      }

      // 2. 检索阶段
      updateItemStatus(index, "检索中...", 50);
      const isArxiv = detectArxiv(line);
      const [oa, cr] = await Promise.all([
        queryOpenAlex(parsed, mailto, isArxiv).catch((e) => ({
          __error: e.message,
        })),
        queryCrossref(parsed, mailto, isArxiv).catch((e) => ({
          __error: e.message,
        })),
      ]);

      // 3. 评分阶段
      updateItemStatus(index, "评分中...", 75);

      const oaItems = oa?.results || [];
      const crItems = cr?.message?.items || [];

      const oaScoreFn = isArxiv ? scoreOpenAlexWorkArxiv : scoreOpenAlexWork;
      const crScoreFn = isArxiv ? scoreCrossrefItemArxiv : scoreCrossrefItem;

      const oaBest = pickBest(oaItems, (w) => oaScoreFn(parsed, w));
      const crBest = pickBest(crItems, (it) => crScoreFn(parsed, it));

      let oaRuleScore = oaBest?.best ? oaBest.bestScore : 0;
      let crRuleScore = crBest?.best ? crBest.bestScore : 0;
      let aiScoringResult = null;

      // 如果启用 AI 评分，调用 AI 进行评分（scoreWithAI 内部已有 30s 超时）
      if (useAiScoring && (oaBest?.best || crBest?.best)) {
        try {
          aiScoringResult = await scoreWithAI(
            line,
            parsed,
            oaBest?.best,
            crBest?.best,
            isArxiv,
          );
          if (aiScoringResult) {
            // 保存 AI 评分详情
            if (aiScoringResult.openAlex !== null && oaBest) {
              oaBest.aiDetails = aiScoringResult.openAlex.details;
              oaBest.aiScore = aiScoringResult.openAlex.total;
            }
            if (aiScoringResult.crossref !== null && crBest) {
              crBest.aiDetails = aiScoringResult.crossref.details;
              crBest.aiScore = aiScoringResult.crossref.total;
            }
          }
        } catch (e) {
          console.error("AI 评分失败:", e.message);
          // AI 评分失败，继续使用规则评分
        }
      }

      // 计算综合评分：使用 max(规则评分, AI评分) 作为各字段的最终分数
      const oaScore = Math.max(oaRuleScore, oaBest?.aiScore || 0);
      const crScore = Math.max(crRuleScore, crBest?.aiScore || 0);

      // 赢者通吃：综合评分 = max(OA, CR)
      const highSource = oaScore >= crScore ? "openAlex" : "crossref";
      const combined = Math.max(oaScore, crScore);
      const combinedDetails = {
        openAlex: {
          score: oaScore,
          weight: highSource === "openAlex" ? 1.0 : 0,
          weighted: highSource === "openAlex" ? oaScore : 0,
        },
        crossref: {
          score: crScore,
          weight: highSource === "crossref" ? 1.0 : 0,
          weighted: highSource === "crossref" ? crScore : 0,
        },
      };

      const result = {
        raw: line,
        parsed,
        oaBest,
        crBest,
        oaScore,
        crScore,
        combined,
        combinedDetails,
        verdict: getVerdict(combined),
        isArxiv,
        useAiScoring: aiScoringResult !== null,
      };

      results[index] = result;

      // 4. 完成
      updateItemStatus(index, "完成", 100);

      // 替换占位为真实结果
      const placeholder = document.getElementById(`processing-${index}`);
      if (placeholder) {
        setTimeout(() => {
          placeholder.outerHTML = renderResult(result, index);
        }, 200);
      }
    } catch (e) {
      const errorResult = {
        raw: line,
        parsed: parseCitation(line),
        oaBest: null,
        crBest: null,
        oaScore: 0,
        crScore: 0,
        combined: 0,
        verdict: { level: "low", text: "错误", desc: e.message },
      };
      results[index] = errorResult;

      updateItemStatus(index, "错误: " + e.message, 100);

      const placeholder = document.getElementById(`processing-${index}`);
      if (placeholder) {
        setTimeout(() => {
          placeholder.outerHTML = renderResult(errorResult, index);
        }, 200);
      }
    }

    completedCount++;
    updateProgress(
      completedCount,
      lines.length,
      `已完成 ${completedCount}/${lines.length} 条`,
    );
  }

  // 并发控制器
  async function runWithConcurrency(tasks, limit) {
    const executing = new Set();

    for (const task of tasks) {
      const promise = task().then(() => {
        executing.delete(promise);
      });
      executing.add(promise);

      if (executing.size >= limit) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
  }

  // 创建任务列表
  const tasks = lines.map((_, index) => () => processItem(index));

  // 执行并发请求
  await runWithConcurrency(tasks, concurrency);

  updateProgress(lines.length, lines.length, "校验完成");
  updateStats(results);
  saveToHistory(rawText, results);

  btn.disabled = false;
  btn.textContent = originalText;

  // 隐藏进度条
  setTimeout(() => {
    progressDiv.classList.remove("active");
  }, 1000);
});

document.getElementById("clear").addEventListener("click", () => {
  document.getElementById("citation").value = "";
  document.getElementById("results").innerHTML = "";
  document.getElementById("summary").classList.remove("active");
  document.getElementById("progress").classList.remove("active");
  document.getElementById("exportSection").classList.remove("active");
  window.currentResults = [];
  citationFormatted = false;
  updateCitationCount();
});


// 文本整理按钮
document.getElementById("formatText").addEventListener("click", () => {
  const textarea = document.getElementById("citation");
  const rawText = textarea.value;

  if (!rawText.trim()) {
    showToast("请先输入引用文本");
    return;
  }

  const btn = document.getElementById("formatText");
  const originalText = btn.textContent;

  // 禁用按钮和文本区
  btn.disabled = true;
  btn.textContent = "整理中...";
  textarea.disabled = true;

  // 使用 setTimeout 让 UI 有时间更新
  setTimeout(() => {
    try {
      const formatted = formatCitationText(rawText);
      textarea.value = formatted;
      citationFormatted = true;
      updateCitationCount();

      // 统计处理结果
      const lineCount = formatted.split("\n").filter((l) => l.trim()).length;
      showToast(`整理完成，共 ${lineCount} 条引用`);
    } finally {
      // 恢复按钮和文本区
      btn.disabled = false;
      btn.textContent = originalText;
      textarea.disabled = false;
    }
  }, 10);
});

/**
 * 智能整理引用文本
 * 1. 中文引号转英文引号
 * 2. 智能合并同一条目内的换行
 * 3. 不同条目之间用空行分隔
 * 4. 移除多余空白
 */

// AI 文本整理按钮
/** ---------- AI 文本整理功能 ---------- */
document.getElementById("aiFormatText").addEventListener("click", async () => {
  const config = loadAiConfig();
  if (!config || !config.apiKey) {
    showToast("请先配置 AI API");
    document.getElementById("aiConfigModal").classList.add("show");
    return;
  }

  const textarea = document.getElementById("citation");
  const rawText = textarea.value;

  if (!rawText.trim()) {
    showToast("请先输入引用文本");
    return;
  }

  const btn = document.getElementById("aiFormatText");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "整理中...";
  textarea.disabled = true;

  try {
    const formatted = await formatCitationTextWithAI(rawText, config);
    if (formatted) {
      textarea.value = formatted;
      citationFormatted = true;
      updateCitationCount();
      const lineCount = formatted.split("\n").filter((l) => l.trim()).length;
      showToast(`AI 整理完成，共 ${lineCount} 条引用`);
    } else {
      showToast("AI 整理失败，请重试");
    }
  } catch (e) {
    console.error("AI 整理错误:", e);
    showToast("AI 整理失败: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
    textarea.disabled = false;
  }
});


// 导出选项切换
document.querySelectorAll(".export-option").forEach((option) => {
  option.addEventListener("click", () => {
    document
      .querySelectorAll(".export-option")
      .forEach((o) => o.classList.remove("active"));
    option.classList.add("active");
    exportMode = option.dataset.value;
    updateExportTooltips();
  });
});

// 导出/复制按钮
// 下载校验报告
document.getElementById("exportReport").addEventListener("click", () => {
  const { results, message, needSwitch } = getResultsForExport();
  if (results.length === 0) {
    showToast(message);
    if (needSwitch) switchToAll();
    return;
  }

  const csv = generateReportCSV(results);
  const filename = `citation_report_${new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/:/g, "-")}.csv`;

  // 添加 BOM 以支持 Excel 正确显示中文
  const bom = "\uFEFF";
  downloadFile(bom + csv, filename);
  showToast(`已下载 ${results.length} 条校验报告`);
});

// 下载 BibTeX
document.getElementById("exportBib").addEventListener("click", () => {
  const { results, message, needSwitch } = getResultsForExport();
  if (results.length === 0) {
    showToast(message);
    if (needSwitch) switchToAll();
    return;
  }

  const allBibtex = generateBibTeXString(results);
  const filename = `citations_${new Date().toISOString().slice(0, 10)}.bib`;
  downloadFile(allBibtex, filename);
  showToast(`已下载 ${results.length} 条 BibTeX`);
});

// 复制 BibTeX
document.getElementById("copyBib").addEventListener("click", async () => {
  const { results, message, needSwitch } = getResultsForExport();
  if (results.length === 0) {
    showToast(message);
    if (needSwitch) switchToAll();
    return;
  }

  const allBibtex = generateBibTeXString(results);
  const success = await copyToClipboard(allBibtex);

  if (success) {
    showToast(`已复制 ${results.length} 条 BibTeX`);
  } else {
    showToast("复制失败，请重试");
  }
});

// 提取 BibTeX 按钮
// 提取 BibTeX（不调用 API）
document.getElementById("extractBib").addEventListener("click", async () => {
  const btn = document.getElementById("extractBib");
  const rawText = document.getElementById("citation").value;
  const resultsDiv = document.getElementById("results");
  const summaryDiv = document.getElementById("summary");
  const exportSection = document.getElementById("exportSection");
  const progressDiv = document.getElementById("progress");

  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    resultsDiv.innerHTML = `
      <div class="card empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
        <div>请输入至少一条引用</div>
      </div>
    `;
    return;
  }

  // 检查是否启用 AI 解析
  const useAi = localStorage.getItem(AI_ENABLED_KEY) === "true";

  // 如果启用 AI，显示进度条
  if (useAi) {
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.innerHTML = `<span class="loading-spinner"></span> AI 解析中...`;
    resultsDiv.innerHTML = "";
    progressDiv.classList.add("active");
    updateProgress(0, lines.length, "AI 解析中...");
  }

  // 生成仅解析的结果（不调用 API）
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let parsed;

    if (useAi) {
      updateProgress(i, lines.length, `AI 解析第 ${i + 1} 条...`);
      parsed = await parseWithAI(line);
      if (!parsed) {
        // AI 解析失败，回退到规则解析
        parsed = parseCitation(line);
      }
    } else {
      parsed = parseCitation(line);
    }

    results.push({
      raw: line,
      parsed: parsed,
      oaBest: null,
      crBest: null,
      oaScore: 0,
      crScore: 0,
      combined: 0,
      verdict: { level: "medium", text: "未校验", desc: "基于解析" },
      isExtracted: true, // 标记为仅提取，未校验
    });
  }

  // 恢复按钮状态
  if (useAi) {
    btn.disabled = false;
    btn.innerHTML = `生成 BibTeX`;
    updateProgress(lines.length, lines.length, "解析完成");
    setTimeout(() => progressDiv.classList.remove("active"), 1000);
  }

  // 显示结果
  resultsDiv.innerHTML = results
    .map((r, i) => renderExtractedResult(r, i))
    .join("");

  // 更新统计
  const total = results.length;
  document.getElementById("statTotal").textContent = total;
  document.getElementById("statHigh").textContent = "-";
  document.getElementById("statMedium").textContent = "-";
  document.getElementById("statLow").textContent = "-";
  summaryDiv.classList.add("active");
  exportSection.classList.add("active");

  // 保存结果到全局变量
  window.currentResults = results;
  window.extractedMode = true; // 标记当前为提取模式
  saveToHistory(rawText, results);

  // 提取模式下重置选择器为"全部"
  exportMode = "all";
  document
    .querySelectorAll(".export-option")
    .forEach((o) => o.classList.remove("active"));
  document
    .querySelector(".export-option[data-value='all']")
    .classList.add("active");
});

// 默认展开第一个结果
window.toggleResult = toggleResult;
window.copyBibTeX = copyBibTeX;
window.copyExtractedBib = copyExtractedBib;

// 弹窗事件
// 点击遮罩关闭弹窗
document.getElementById("scoreRulesModal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) {
    closeScoreRulesModal();
  }
});

document.getElementById("formatGuideModal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) {
    closeFormatGuideModal();
  }
});

// ESC 键关闭弹窗
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeScoreRulesModal();
    closeFormatGuideModal();
  }
});

// 绑定按钮事件
document
  .getElementById("showScoreRules")
  .addEventListener("click", openScoreRulesModal);
document
  .getElementById("showFormatGuide")
  .addEventListener("click", openFormatGuideModal);
document.getElementById("feedback").addEventListener("click", () => {
  window.open("https://github.com/QAbot-zh/citation-checker/issues", "_blank");
});

window.closeScoreRulesModal = closeScoreRulesModal;
window.closeFormatGuideModal = closeFormatGuideModal;

// 模型下拉框外部点击关闭
document.addEventListener("click", (e) => {
  const combo = document.getElementById("aiModelCombo");
  if (combo && !combo.contains(e.target)) {
    hideModelDropdown();
  }
});

// AI 配置面板事件
// 温度滑块事件
document.getElementById("aiTemperature").addEventListener("input", (e) => {
  document.getElementById("aiTempValue").textContent = e.target.value;
});

// API Key 显示/隐藏切换
document.getElementById("aiApiKeyToggle").addEventListener("click", () => {
  const input = document.getElementById("aiApiKey");
  const btn = document.getElementById("aiApiKeyToggle");
  const isHidden = input.type === "password";
  input.type = isHidden ? "text" : "password";
  btn.querySelector(".eye-open").style.display = isHidden ? "none" : "";
  btn.querySelector(".eye-closed").style.display = isHidden ? "" : "none";
});

// AI 复选框事件
document.getElementById("useAiParsing").addEventListener("change", (e) => {
  localStorage.setItem(AI_ENABLED_KEY, e.target.checked ? "true" : "false");
});

// AI 评分复选框事件
document.getElementById("useAiScoring").addEventListener("change", (e) => {
  localStorage.setItem("aiScoringEnabled", e.target.checked ? "true" : "false");
});

// 打开配置链接
document
  .getElementById("openAiConfig")
  .addEventListener("click", openAiConfigModal);

// AI 配置抽屉点击遮罩关闭
document.getElementById("aiConfigModal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) {
    closeAiConfigModal();
  }
});

// 初始化字段权重 checkbox 状态
(function initFieldEnableCheckboxes() {
  const fieldKeys = [
    "title",
    "author",
    "journal",
    "year",
    "volume",
    "issue",
    "firstPage",
    "lastPage",
  ];
  for (const key of fieldKeys) {
    const cb = document.getElementById("field-enable-" + key);
    if (!cb) continue;
    if (key === "title") continue; // 标题始终禁用且勾选
    // 恢复 localStorage 状态
    if (disabledFields.has(key)) {
      cb.checked = false;
      cb.closest("tr").classList.add("field-disabled");
    }
    cb.addEventListener("change", function () {
      const row = this.closest("tr");
      if (this.checked) {
        disabledFields.delete(key);
        row.classList.remove("field-disabled");
      } else {
        disabledFields.add(key);
        row.classList.add("field-disabled");
      }
      localStorage.setItem(
        DISABLED_FIELDS_KEY,
        JSON.stringify([...disabledFields]),
      );
      updateWeightDisplay();
      refreshAllResults();
    });
  }
  updateWeightDisplay();
})();

// ---------- 主题切换 ----------
const THEME_KEY = "citation_checker_theme";

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light") {
    document.documentElement.setAttribute("data-theme", saved);
  } else {
    // 检测系统偏好
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = prefersDark ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
}

window.toggleTheme = toggleTheme;

initTheme();

// 页面加载时初始化 AI 配置 UI
updateAiConfigUI();

// 初始化并发数配置
const savedConcurrency = localStorage.getItem(CONCURRENCY_KEY);
if (savedConcurrency) {
  const val = parseInt(savedConcurrency, 10);
  if (val >= 1 && val <= 20) {
    document.getElementById("concurrency").value = val;
  }
}

// 并发数改变时保存到 localStorage
document.getElementById("concurrency").addEventListener("change", (e) => {
  const val = parseInt(e.target.value, 10);
  if (val >= 1 && val <= 20) {
    localStorage.setItem(CONCURRENCY_KEY, val);
  }
});

window.closeAiConfigModal = closeAiConfigModal;
window.saveAiConfig = saveAiConfig;
window.clearAiConfig = clearAiConfig;
window.testAiConfig = testAiConfig;
window.fetchModelList = fetchModelList;
window.filterModelList = filterModelList;
window.showModelDropdown = showModelDropdown;
