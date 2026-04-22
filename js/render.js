/** ---------- UI 渲染 ---------- */
// 生成评分详情 tooltip HTML
// aiTotal 参数是 AI 评分函数计算的总分，确保和胶囊显示一致
function renderScoreTooltip(ruleDetails, aiDetails, aiTotal) {
  if (!ruleDetails && !aiDetails) return "";

  const labels = {
    title: "标题",
    author: "作者",
    authors: "作者",
    journal: "期刊",
    year: "年份",
    volume: "卷号",
    issue: "期号",
    firstPage: "首页",
    lastPage: "末页",
  };

  const getScoreClass = (score) => {
    if (score >= 0.8) return "good";
    if (score >= 0.5) return "medium";
    return "bad";
  };

  // 统一按 BASE_WEIGHTS 定义的字段顺序渲染，避免两个数据源 tooltip 顺序不一致
  const present = new Set(Object.keys(ruleDetails || aiDetails || {}));
  const allKeys = Object.keys(BASE_WEIGHTS).filter((k) => present.has(k));

  let rows = "";
  let ruleTotal = 0;

  // 表头
  if (aiDetails) {
    rows += `
      <div class="score-tooltip-row score-tooltip-header">
        <span class="score-tooltip-label">字段</span>
        <span class="score-tooltip-value">规则</span>
        <span class="score-tooltip-value">AI</span>
      </div>`;
  }

  for (const key of allKeys) {
    const ruleVal = ruleDetails?.[key];
    const aiVal = aiDetails?.[key];
    const label = labels[key] || key;
    const weight = ruleVal?.weight || aiVal?.weight || 0;
    const isDisabled = weight === 0;

    const ruleScore = ruleVal?.score ?? 0;
    const aiScore = aiVal?.score ?? 0;

    ruleTotal += ruleScore * weight;

    const disabledStyle = isDisabled ? "opacity:0.4;text-decoration:line-through;" : "";

    if (aiDetails) {
      // 同时显示规则和 AI 评分
      rows += `
      <div class="score-tooltip-row" style="${disabledStyle}">
        <span class="score-tooltip-label">${label} (${(weight * 100).toFixed(0)}%)</span>
        <span class="score-tooltip-value ${isDisabled ? "" : getScoreClass(ruleScore)}">${ruleScore.toFixed(2)}</span>
        <span class="score-tooltip-value ${isDisabled ? "" : (aiVal ? getScoreClass(aiScore) : "")}">${aiVal ? aiScore.toFixed(2) : "-"}</span>
      </div>`;
    } else {
      // 只显示规则评分
      rows += `
      <div class="score-tooltip-row" style="${disabledStyle}">
        <span class="score-tooltip-label">${label} (${(weight * 100).toFixed(0)}%)</span>
        <span class="score-tooltip-value ${isDisabled ? "" : getScoreClass(ruleScore)}">${ruleScore.toFixed(2)} × ${weight.toFixed(2)} = ${(ruleScore * weight).toFixed(3)}</span>
      </div>`;
    }
  }

  // 总分行
  if (aiDetails) {
    // 使用传入的 aiTotal，确保和胶囊显示一致
    const displayAiTotal = aiTotal ?? 0;
    rows += `
      <div class="score-tooltip-row score-tooltip-total">
        <span class="score-tooltip-label">总分</span>
        <span class="score-tooltip-value ${getScoreClass(ruleTotal)}">${ruleTotal.toFixed(2)}</span>
        <span class="score-tooltip-value ${getScoreClass(displayAiTotal)}">${displayAiTotal.toFixed(2)}</span>
      </div>`;
  } else {
    rows += `
      <div class="score-tooltip-row score-tooltip-total">
        <span class="score-tooltip-label">总分</span>
        <span class="score-tooltip-value ${getScoreClass(ruleTotal)}">${ruleTotal.toFixed(3)}</span>
      </div>`;
  }

  const width = aiDetails ? "min-width: 280px;" : "";
  return `<div class="score-tooltip" style="${width}">${rows}</div>`;
}

// 生成综合评分 tooltip HTML
function renderCombinedTooltip(combinedDetails, oaDetails, crDetails) {
  if (!combinedDetails) return "";

  const getScoreClass = (score) => {
    if (score >= 0.78) return "good";
    if (score >= 0.55) return "medium";
    return "bad";
  };

  const oaScore = combinedDetails.openAlex.score;
  const crScore = combinedDetails.crossref.score;

  // 赢者通吃：综合得分 = max(OA, CR)
  const combined = Math.max(oaScore, crScore);

  let rows = `
    <div class="score-tooltip-row" style="padding-bottom: 8px; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.15);">
      <span class="score-tooltip-label" style="font-weight: 600; color: rgba(255,255,255,0.9);">
        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: linear-gradient(135deg, #10b981, #34d399); margin-right: 6px; box-shadow: 0 0 6px rgba(16, 185, 129, 0.4);"></span>
        综合评分公式
      </span>
      <span class="score-tooltip-value" style="background: transparent; font-size: 14px;">max(OA, CR)</span>
    </div>
    <div class="score-tooltip-row">
      <span class="score-tooltip-label">
        <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: linear-gradient(135deg, #4f46e5, #818cf8); margin-right: 6px;"></span>
        OpenAlex ${oaScore >= crScore ? "(主)" : "(次)"}
      </span>
      <span class="score-tooltip-value ${getScoreClass(oaScore)}">${oaScore.toFixed(3)}</span>
    </div>
    <div class="score-tooltip-row">
      <span class="score-tooltip-label">
        <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: linear-gradient(135deg, #f59e0b, #fbbf24); margin-right: 6px;"></span>
        Crossref ${crScore > oaScore ? "(主)" : "(次)"}
      </span>
      <span class="score-tooltip-value ${getScoreClass(crScore)}">${crScore.toFixed(3)}</span>
    </div>`;

  rows += `
    <div class="score-tooltip-row">
      <span class="score-tooltip-label">综合得分</span>
      <span class="score-tooltip-value ${getScoreClass(combined)}">${combined.toFixed(3)}</span>
    </div>
  `;

  return `<div class="score-tooltip" style="min-width: 280px;">${rows}</div>`;
}

function renderSearchDropdown(parsed) {
  if (!parsed.title) return "";

  const q = encodeURIComponent(parsed.title);
  const engines = [
    { name: "Google Scholar", url: `https://scholar.google.com/scholar?q=${q}`, icon: "google-scholar.svg", cls: "google" },
    { name: "arXiv", url: `https://arxiv.org/search/?query=${q}&searchtype=all`, icon: "arxiv.svg", cls: "arxiv" },
    { name: "IEEE Xplore", url: `https://ieeexplore.ieee.org/search/searchresult.jsp?queryText=${q}`, icon: "ieee.svg", cls: "ieee" },
    { name: "Semantic Scholar", url: `https://www.semanticscholar.org/search?q=${q}&sort=relevance`, icon: "semantic-scholar.png", cls: "semantic" },
  ];

  const items = engines.map(e => `
    <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer" class="search-dropdown-item ${e.cls}" onclick="event.stopPropagation()">
      <img src="assets/icons/${e.icon}" alt="${e.name}">
      ${e.name}
    </a>
  `).join("");

  return `
    <div class="search-dropdown" onclick="event.stopPropagation()">
      <div class="search-dropdown-trigger">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        人工校验
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div class="search-dropdown-menu">
        ${items}
      </div>
    </div>
  `;
}

function renderResult(result, index) {
  const {
    raw,
    parsed,
    oaBest,
    crBest,
    oaScore,
    crScore,
    combined,
    combinedDetails,
    verdict,
    isArxiv,
    useAiScoring,
  } = result;
  const oa = oaBest?.best;
  const cr = crBest?.best;
  const oaRuleDetails = oaBest?.bestDetails;
  const crRuleDetails = crBest?.bestDetails;
  const oaAiDetails = oaBest?.aiDetails;
  const crAiDetails = crBest?.aiDetails;

  // 格式化 OpenAlex 作者
  const formatOaAuthors = (authorships) => {
    if (!authorships || authorships.length === 0) return "-";
    return authorships
      .map((a) => {
        const name = a.author?.display_name || a.raw_author_name || "";
        // 处理 OpenAlex 中文名字格式 "爽 薛" -> "薛爽"
        const parts = name.trim().split(/\s+/);
        if (parts.length === 2) {
          const [p1, p2] = parts;
          const isChinese = (s) => /^[\u4e00-\u9fa5]+$/.test(s);
          if (isChinese(p1) && isChinese(p2)) {
            // 如果第二部分是单字（姓），格式是 "名 姓"
            if (p2.length === 1) return p2 + p1;
            // 如果第一部分是单字（姓），格式是 "姓 名"
            if (p1.length === 1) return p1 + p2;
          }
        }
        return name;
      })
      .join(", ");
  };

  // 格式化 Crossref 作者
  const formatCrAuthors = (authors) => {
    if (!authors || authors.length === 0) return "-";
    return authors
      .map((a) => {
        const family = a.family || "";
        const given = a.given || "";
        // 检测中文名字
        const isChinese = (s) => /^[\u4e00-\u9fa5]+$/.test(s.trim());
        if (isChinese(family) || isChinese(given)) {
          return family + given;
        }
        return given ? `${given} ${family}` : family;
      })
      .join(", ");
  };

  // 获取综合评分详情（取两个数据源中较高的分数，优先使用 AI 评分）
  const getFieldScore = (field) => {
    const oaFieldScore =
      oaAiDetails?.[field]?.score ?? oaRuleDetails?.[field]?.score ?? 0;
    const crFieldScore =
      crAiDetails?.[field]?.score ?? crRuleDetails?.[field]?.score ?? 0;
    return Math.max(oaFieldScore, crFieldScore);
  };

  // 判断字段是否低分（< 0.5）并返回样式
  const getLowScoreStyle = (field) => {
    const score = getFieldScore(field);
    return score < 0.5 ? "color: var(--danger);" : "";
  };

  // 获取 OpenAlex 字段的低分样式（优先使用 AI 评分）
  const getOaLowScoreStyle = (field) => {
    const score =
      oaAiDetails?.[field]?.score ?? oaRuleDetails?.[field]?.score ?? 0;
    return score < 0.5 ? "color: var(--danger);" : "";
  };

  // 获取 Crossref 字段的低分样式（优先使用 AI 评分）
  const getCrLowScoreStyle = (field) => {
    const score =
      crAiDetails?.[field]?.score ?? crRuleDetails?.[field]?.score ?? 0;
    return score < 0.5 ? "color: var(--danger);" : "";
  };

  return `
    <div class="result-item" data-index="${index}">
      <div class="result-header" onclick="toggleResult(${index})">
        <div class="result-index">${index + 1}</div>
        <div class="result-title">${esc(parsed.title || raw.slice(0, 80))}</div>
        <span class="format-badge">${esc(parsed.format || "通用")}</span>
        ${renderSearchDropdown(parsed)}
        <div class="score-tooltip-wrapper result-score-wrapper" onclick="event.stopPropagation()">
          <div class="result-score ${verdict.level}">${
            verdict.text
          } ${combined.toFixed(2)}${useAiScoring ? ' <span class="ai-score-badge">AI</span>' : ""}</div>
          ${renderCombinedTooltip(combinedDetails, oaRuleDetails, crRuleDetails)}
        </div>
        <div class="result-toggle">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      </div>
      <div class="result-details">
        <div class="detail-section">
          <h4>解析字段</h4>
          <div class="detail-grid">
            <div class="detail-label">原始引用</div>
            <div class="detail-value" style="font-size:12px;color:var(--text-muted)">${esc(
              raw,
            )}</div>
            <div class="detail-label">标题</div>
            <div class="detail-value">${esc(parsed.title || "-")}</div>
            <div class="detail-label">作者</div>
            <div class="detail-value">${esc(
              (parsed.authors || []).join(", ") || "-",
            )}</div>
            <div class="detail-label">期刊/出版社</div>
            <div class="detail-value">${esc(parsed.journal || "-")}</div>
            <div class="detail-label">年份</div>
            <div class="detail-value">${esc(parsed.year || "-")}</div>
            <div class="detail-label">卷(期):页码</div>
            <div class="detail-value">${esc(parsed.volume || "-")}(${esc(
              parsed.issue || "-",
            )}):${esc(parsed.firstPage || "-")}-${esc(parsed.lastPage || "-")}</div>
            <div class="detail-label">DOI</div>
            <div class="detail-value">${esc(parsed.doi || "未提供")}</div>
          </div>
        </div>

        <div class="sources-grid">
          <div class="source-card">
            <h4>
              <div class="score-tooltip-wrapper">
                <span class="source-badge openalex">OpenAlex</span>
                <span class="score-badges">
                  <span class="score-inline">规则 ${oaBest?.bestScore?.toFixed(2) || "0.00"}</span>
                  ${oaAiDetails ? `<span class="score-inline ai">AI ${(oaBest?.aiScore || 0).toFixed(2)}</span>` : ""}
                </span>
                ${renderScoreTooltip(oaRuleDetails, oaAiDetails, oaBest?.aiScore)}
              </div>
              ${
                oa
                  ? `<a href="${esc(oa.id)}" target="_blank" class="link-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
                详情
              </a>`
                  : ""
              }
            </h4>
            ${
              oa
                ? `
              <div class="detail-grid">
                <div class="detail-label">标题</div>
                <div class="detail-value" style="${getOaLowScoreStyle("title")}">${esc(oa.title || "-")}</div>
                <div class="detail-label">作者</div>
                <div class="detail-value" style="${getOaLowScoreStyle("author")}">${esc(formatOaAuthors(oa.authorships))}</div>
                <div class="detail-label">期刊/出版社</div>
                <div class="detail-value" style="${getOaLowScoreStyle("journal")}">${esc(
                  oa.primary_location?.source?.display_name || "-",
                )}</div>
                <div class="detail-label">年份</div>
                <div class="detail-value" style="${getOaLowScoreStyle("year")}">${esc(
                  oa.publication_year || "-",
                )}</div>
                <div class="detail-label">卷期页</div>
                <div class="detail-value" style="${getOaLowScoreStyle("volume")}${getOaLowScoreStyle("firstPage")}">${esc(
                  oa.biblio?.volume || "-",
                )}(${esc(oa.biblio?.issue || "-")}):${esc(
                  oa.biblio?.first_page || "-",
                )}-${esc(oa.biblio?.last_page || "-")}</div>
                <div class="detail-label">DOI</div>
                <div class="detail-value">${
                  oa.doi
                    ? `<a href="https://doi.org/${esc(
                        oa.doi.replace("https://doi.org/", ""),
                      )}" target="_blank">${esc(oa.doi)}</a>`
                    : "-"
                }</div>
              </div>
            `
                : `<div style="color:var(--text-muted);font-size:13px;padding:20px 0;text-align:center;">未找到匹配结果</div>`
            }
          </div>

          <div class="source-card">
            <h4>
              <div class="score-tooltip-wrapper">
                <span class="source-badge crossref">Crossref</span>
                <span class="score-badges">
                  <span class="score-inline">规则 ${crBest?.bestScore?.toFixed(2) || "0.00"}</span>
                  ${crAiDetails ? `<span class="score-inline ai">AI ${(crBest?.aiScore || 0).toFixed(2)}</span>` : ""}
                </span>
                ${renderScoreTooltip(crRuleDetails, crAiDetails, crBest?.aiScore)}
              </div>
            </h4>
            ${
              cr
                ? `
              <div class="detail-grid">
                <div class="detail-label">标题</div>
                <div class="detail-value" style="${getCrLowScoreStyle("title")}">${esc(
                  (cr.title && cr.title[0]) || "-",
                )}</div>
                <div class="detail-label">作者</div>
                <div class="detail-value" style="${getCrLowScoreStyle("author")}">${esc(formatCrAuthors(cr.author))}</div>
                <div class="detail-label">期刊/出版社</div>
                <div class="detail-value" style="${getCrLowScoreStyle("journal")}">${esc(
                  (cr["container-title"] && cr["container-title"][0]) || "-",
                )}</div>
                <div class="detail-label">年份</div>
                <div class="detail-value" style="${getCrLowScoreStyle("year")}">${esc(
                  cr.issued?.["date-parts"]?.[0]?.[0] || "-",
                )}</div>
                <div class="detail-label">卷期页</div>
                <div class="detail-value" style="${getCrLowScoreStyle("volume")}${getCrLowScoreStyle("firstPage")}">${esc(cr.volume || "-")}(${esc(
                  cr.issue || "-",
                )}):${esc(cr.page || "-")}</div>
                <div class="detail-label">DOI</div>
                <div class="detail-value">${
                  cr.DOI
                    ? `<a href="https://doi.org/${esc(
                        cr.DOI,
                      )}" target="_blank">${esc(cr.DOI)}</a>`
                    : "-"
                }</div>
              </div>
            `
                : isArxiv
                  ? `<div style="color:var(--text-muted);font-size:13px;padding:20px 0;text-align:center;">arXiv 预印本不检索 Crossref</div>`
                  : `<div style="color:var(--text-muted);font-size:13px;padding:20px 0;text-align:center;">未找到匹配结果</div>`
            }
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-actions">
            <span class="btn-tooltip-wrapper">
              <button class="btn btn-extract btn-small" onclick="copyBibTeX(${index}, this)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                </svg>
                复制 BibTeX
              </button>
              <span class="btn-tooltip" style="white-space: pre-wrap; font-family: monospace; font-size: 14px; max-width: 800px; text-align: left; line-height: 1.6;">${esc(generateBibTeX(result))}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function toggleResult(index) {
  const item = document.querySelector(`.result-item[data-index="${index}"]`);
  if (item) item.classList.toggle("expanded");
}

function updateStats(results) {
  const total = results.length;
  const high = results.filter((r) => r.verdict.level === "high").length;
  const medium = results.filter((r) => r.verdict.level === "medium").length;
  const low = results.filter((r) => r.verdict.level === "low").length;

  document.getElementById("statTotal").textContent = total;
  document.getElementById("statHigh").textContent = high;
  document.getElementById("statMedium").textContent = medium;
  document.getElementById("statLow").textContent = low;
  document.getElementById("summary").classList.add("active");

  // 显示导出区域
  if (total > 0) {
    document.getElementById("exportSection").classList.add("active");
  }

  // 保存结果到全局变量供导出使用
  window.currentResults = results;

  // 校验完成后，如果有高可信条目，默认选择"高可信"
  if (!window.extractedMode && high > 0) {
    exportMode = "high";
    document
      .querySelectorAll(".export-option")
      .forEach((o) => o.classList.remove("active"));
    document
      .querySelector(".export-option[data-value='high']")
      .classList.add("active");
    updateExportTooltips();
  } else {
    switchToAll();
  }
}

function updateProgress(current, total, status) {
  const percent = total > 0 ? (current / total) * 100 : 0;
  document.getElementById("progressFill").style.width = percent + "%";
  document.getElementById("progressCount").textContent =
    `${current} / ${total}`;
  document.getElementById("progressStatus").textContent = status;
}


// 渲染仅提取的结果（不调用 API）
function renderExtractedResult(result, index) {
  const { raw, parsed } = result;

  return `
    <div class="result-item" data-index="${index}">
      <div class="result-header" onclick="toggleResult(${index})">
        <div class="result-index">${index + 1}</div>
        <div class="result-title">${esc(parsed.title || raw.slice(0, 80))}</div>
        <span class="format-badge">${esc(parsed.format || "通用")}</span>
        ${renderSearchDropdown(parsed)}
        <div class="result-score medium">未校验</div>
        <div class="result-toggle">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      </div>
      <div class="result-details">
        <div class="detail-section">
          <h4>解析字段</h4>
          <div class="detail-grid">
            <div class="detail-label">原始引用</div>
            <div class="detail-value" style="font-size:12px;color:var(--text-muted)">${esc(
              raw,
            )}</div>
            <div class="detail-label">标题</div>
            <div class="detail-value">${esc(parsed.title || "-")}</div>
            <div class="detail-label">作者</div>
            <div class="detail-value">${esc(
              (parsed.authors || []).join(", ") || "-",
            )}</div>
            <div class="detail-label">期刊</div>
            <div class="detail-value">${esc(parsed.journal || "-")}</div>
            <div class="detail-label">年份</div>
            <div class="detail-value">${esc(parsed.year || "-")}</div>
            <div class="detail-label">卷(期):页码</div>
            <div class="detail-value">${esc(parsed.volume || "-")}(${esc(
              parsed.issue || "-",
            )}):${esc(parsed.firstPage || "-")}-${esc(parsed.lastPage || "-")}</div>
            <div class="detail-label">DOI</div>
            <div class="detail-value">${esc(parsed.doi || "未提供")}</div>
          </div>
        </div>

        <div class="detail-section">
          <h4> BibTeX 预览</h4>
          <pre style="background:var(--bg);padding:12px;border-radius:8px;font-size:12px;overflow-x:auto;max-height:200px;overflow-y:auto;border:1px solid var(--border);">${esc(
            generateBibTeXFromParsed(parsed),
          )}</pre>
        </div>

        <div class="detail-section">
          <div class="detail-actions">
            <span class="btn-tooltip-wrapper">
              <button class="btn btn-extract btn-small" onclick="copyExtractedBib(${index}, this)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                </svg>
                复制 BibTeX
              </button>
              <span class="btn-tooltip" style="white-space: pre-wrap; font-family: monospace; font-size: 14px; max-width: 800px; text-align: left; line-height: 1.6;">${esc(generateBibTeXFromParsed(parsed))}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// 复制提取模式的单个 BibTeX

/** ---------- 弹窗和反馈 ---------- */
// 打开打分标准弹窗
function openScoreRulesModal() {
  document.getElementById("scoreRulesModal").classList.add("show");
  document.body.style.overflow = "hidden";
}

// 关闭打分标准弹窗
function closeScoreRulesModal() {
  document.getElementById("scoreRulesModal").classList.remove("show");
  document.body.style.overflow = "";
}

// 打开格式示例弹窗
function openFormatGuideModal() {
  document.getElementById("formatGuideModal").classList.add("show");
  document.body.style.overflow = "hidden";
}

// 关闭格式示例弹窗
function closeFormatGuideModal() {
  document.getElementById("formatGuideModal").classList.remove("show");
  document.body.style.overflow = "";
}
