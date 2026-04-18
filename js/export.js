/** ---------- BibTeX 导出功能 ---------- */

// 导出模式：all 或 high
let exportMode = "all";

// 更新导出按钮的 tooltip
function updateExportTooltips() {
  const reportTooltip = document
    .querySelector("#exportReport")
    .parentElement.querySelector(".btn-tooltip");
  const downloadTooltip = document
    .querySelector("#exportBib")
    .parentElement.querySelector(".btn-tooltip");
  const copyTooltip = document
    .querySelector("#copyBib")
    .parentElement.querySelector(".btn-tooltip");

  if (exportMode === "all") {
    reportTooltip.textContent = "下载全部条目的校验报告（CSV 格式）";
    downloadTooltip.textContent = "下载全部条目的 BibTeX 文件";
    copyTooltip.textContent = "复制全部条目的 BibTeX 到剪贴板";
  } else {
    reportTooltip.textContent = "下载高可信条目的校验报告（CSV 格式）";
    downloadTooltip.textContent = "下载高可信条目的 BibTeX 文件";
    copyTooltip.textContent = "复制高可信条目的 BibTeX 到剪贴板";
  }
}

// 选择器切换

// 切换到全部模式
function switchToAll() {
  exportMode = "all";
  document
    .querySelectorAll(".export-option")
    .forEach((o) => o.classList.remove("active"));
  document
    .querySelector(".export-option[data-value='all']")
    .classList.add("active");
  updateExportTooltips();
}

// 获取要导出的结果和智能提示信息
function getResultsForExport() {
  const results = window.currentResults || [];
  if (results.length === 0)
    return { results: [], message: "暂无结果", needSwitch: false };

  // 提取模式下没有高可信概念
  if (window.extractedMode && results[0]?.isExtracted) {
    if (exportMode === "high") {
      return {
        results: [],
        message: "未经过校验，无高可信条目",
        needSwitch: true,
      };
    }
    return { results, message: "", needSwitch: false };
  }

  if (exportMode === "high") {
    const highResults = results.filter((r) => r.verdict.level === "high");
    if (highResults.length === 0) {
      const medium = results.filter((r) => r.verdict.level === "medium").length;
      const low = results.filter((r) => r.verdict.level === "low").length;
      if (medium > 0 || low > 0) {
        return {
          results: [],
          message: `无高可信条目（${medium}中可信/${low}低可信）`,
          needSwitch: true,
        };
      }
      return { results: [], message: "无高可信条目", needSwitch: true };
    }
    return { results: highResults, message: "", needSwitch: false };
  }

  return { results, message: "", needSwitch: false };
}

// 生成 BibTeX 字符串
function generateBibTeXString(results) {
  if (results.length === 0) return "";

  const isExtractedMode = window.extractedMode && results[0]?.isExtracted;
  return results
    .map((r) =>
      isExtractedMode ? generateBibTeXFromParsed(r.parsed) : generateBibTeX(r),
    )
    .join("\n\n");
}

// 生成校验报告 CSV
function generateReportCSV(results) {
  if (results.length === 0) return "";

  // CSV 转义函数
  const csvEscape = (str) => {
    if (str == null) return "";
    const s = String(str);
    if (s.includes('"') || s.includes(",") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  // CSV 表头
  const headers = [
    "序号",
    "原始引用",
    "可信度",
    "最终得分",
    "OpenAlex规则得分",
    "OpenAlex AI得分",
    "Crossref规则得分",
    "Crossref AI得分",
    "标题",
    "作者",
    "期刊/出版社",
    "年份",
    "卷",
    "期",
    "首页",
    "末页",
    "DOI",
  ];

  const rows = results.map((r, index) => {
    const parsed = r.parsed || {};
    const verdict = r.verdict || {};

    // 获取得分 - 使用正确的数据结构
    const oaBest = r.oaBest || {};
    const crBest = r.crBest || {};

    // 可信度映射
    const levelMap = { high: "高可信", medium: "中可信", low: "低可信" };

    return [
      index + 1,
      r.raw || "",
      levelMap[verdict.level] || "",
      (r.combined || 0).toFixed(2),
      (oaBest.bestScore || 0).toFixed(2),
      (oaBest.aiScore || 0).toFixed(2),
      (crBest.bestScore || 0).toFixed(2),
      (crBest.aiScore || 0).toFixed(2),
      parsed.title || "",
      parsed.authors?.join("; ") || "",
      parsed.journal || "",
      parsed.year || "",
      parsed.volume || "",
      parsed.issue || "",
      parsed.firstPage || "",
      parsed.lastPage || "",
      parsed.doi || "",
    ]
      .map(csvEscape)
      .join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

// 复制单个 BibTeX（结果项内）
async function copyBibTeX(index, button) {
  const results = window.currentResults || [];
  if (!results[index]) return;

  const isExtracted = window.extractedMode && results[index]?.isExtracted;
  const bibtex = isExtracted
    ? generateBibTeXFromParsed(results[index].parsed)
    : generateBibTeX(results[index]);
  const success = await copyToClipboard(bibtex);

  if (success) {
    const originalText = button.innerHTML;
    button.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> 已复制`;
    setTimeout(() => (button.innerHTML = originalText), 2000);
  } else {
    showToast("复制失败，请重试");
  }
}


async function copyExtractedBib(index, button) {
  const results = window.currentResults || [];
  if (!results[index]) return;

  const bibtex = generateBibTeXFromParsed(results[index].parsed);
  const success = await copyToClipboard(bibtex);

  if (success) {
    const originalText = button.innerHTML;
    button.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> 已复制`;
    setTimeout(() => (button.innerHTML = originalText), 2000);
  } else {
    showToast("复制失败，请重试");
  }
}
