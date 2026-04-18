/** ---------- AI 评分 ---------- */
async function scoreWithAI(raw, parsed, oaBestItem, crBestItem, isArxiv) {
  const config = loadAiConfig();
  if (!config || !config.apiKey) return null;

  // 构建 OpenAlex 最佳匹配的信息
  let oaInfo = null;
  if (oaBestItem) {
    oaInfo = {
      title: oaBestItem.title || "",
      authors: (oaBestItem.authorships || [])
        .map((a) => a.author?.display_name || "")
        .filter(Boolean),
      journal: oaBestItem.primary_location?.source?.display_name || "",
      year: oaBestItem.publication_year,
      volume: oaBestItem.biblio?.volume || "",
      issue: oaBestItem.biblio?.issue || "",
      firstPage: oaBestItem.biblio?.first_page || "",
      lastPage: oaBestItem.biblio?.last_page || "",
    };
  }

  // 构建 Crossref 最佳匹配的信息
  let crInfo = null;
  if (crBestItem) {
    crInfo = {
      title: crBestItem.title?.[0] || "",
      authors: (crBestItem.author || [])
        .map((a) =>
          a.family ? `${a.given || ""} ${a.family}`.trim() : a.name || "",
        )
        .filter(Boolean),
      journal: crBestItem["container-title"]?.[0] || "",
      year: crBestItem.issued?.["date-parts"]?.[0]?.[0],
      volume: crBestItem.volume || "",
      issue: crBestItem.issue || "",
      firstPage: crBestItem.page?.split("-")[0] || "",
      lastPage: crBestItem.page?.split("-")[1] || "",
    };
  }

  // 构建原始引用的解析信息
  const parsedInfo = {
    title: parsed.title || "",
    authors: parsed.authors || [],
    journal: parsed.journal || "",
    year: parsed.year,
    volume: parsed.volume || "",
    issue: parsed.issue || "",
    firstPage: parsed.firstPage || "",
    lastPage: parsed.lastPage || "",
  };

  const fields = isArxiv
    ? ["title", "author", "year"]
    : [
        "title",
        "author",
        "journal",
        "year",
        "volume",
        "issue",
        "firstPage",
        "lastPage",
      ];

  const prompt = `你是一个学术引用校验专家。请对比原始引用与数据库检索结果，为每个字段评分。

原始引用文本：
${raw}

解析后的字段：
${JSON.stringify(parsedInfo, null, 2)}

${
  oaInfo
    ? `OpenAlex 检索结果：
${JSON.stringify(oaInfo, null, 2)}`
    : "OpenAlex：无匹配结果"
}

${
  crInfo
    ? `Crossref 检索结果：
${JSON.stringify(crInfo, null, 2)}`
    : "Crossref：无匹配结果"
}

请为每个数据源的以下字段评分（0-1 之间的小数）：
title, author, ${isArxiv ? "year" : "journal, year, volume, issue, firstPage, lastPage"}

评分标准：
- 1.0：完全匹配或语义等价
- 0.8-0.99：高度相似，仅有细微差异（如标点、缩写）
- 0.5-0.79：部分匹配，核心信息一致
- 0.1-0.49：有一定关联但差异明显
- 0：完全不匹配

重要规则：
- 如果原始引用中某字段为空或缺失，该字段必须评 0 分
- 如果检索结果中某字段为空或缺失，该字段必须评 0 分
- author 字段请评估作者列表的匹配程度

请以 JSON 格式返回，格式如下：
{
  "openAlex": ${oaInfo ? `{ "title": 0.95, "author": 0.8, ... }` : "null"},
  "crossref": ${crInfo ? `{ "title": 0.95, "author": 0.8, ... }` : "null"}
}

只返回 JSON，不要其他内容。`;

  const response = await fetchWithTimeout(
    `${config.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      }),
    },
    30000,
  );

  if (!response.ok) {
    throw new Error(`AI API 错误: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  // 解析 JSON 响应
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  const scores = JSON.parse(jsonMatch[0]);

  // 计算加权总分
  const weights = getActiveWeights(isArxiv);

  const result = { openAlex: null, crossref: null };

  if (scores.openAlex && oaInfo) {
    let total = 0;
    const details = {};
    for (const field of fields) {
      const score = scores.openAlex[field] ?? 0;
      const weight = weights[field] || 0;
      total += score * weight;
      details[field] = { score, weight, weighted: score * weight };
    }
    result.openAlex = { total, details };
  }

  if (scores.crossref && crInfo) {
    let total = 0;
    const details = {};
    for (const field of fields) {
      const score = scores.crossref[field] ?? 0;
      const weight = weights[field] || 0;
      total += score * weight;
      details[field] = { score, weight, weighted: score * weight };
    }
    result.crossref = { total, details };
  }

  return result;
}


/**
 * 使用 AI 整理引用文本
 */
async function formatCitationTextWithAI(text, config) {
  const prompt = `你是一个学术引用格式整理助手。请整理以下从网页或 PDF 复制的引用文本。

任务：
1. 识别并分离每一条独立的引用条目
2. 合并同一条目内被错误换行分割的内容
3. 将中文引号（“”‘’）转换为英文引号（""''）
4. 移除引用序号（如 [1]、1.、(1) 等）
5. 移除多余的空白和换行
6. 每条引用单独一行，条目之间用一个空行分隔

原始文本：
${text}

请直接返回整理后的引用列表，不要添加任何解释或说明。每条引用一行，条目之间空一行。`;

  const response = await fetchWithTimeout(
    `${config.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      }),
    },
    60000,
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `API 错误: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  return content.trim();
}


/** ---------- AI 配置功能 ---------- */

// 加载 AI 配置
function loadAiConfig() {
  try {
    const config = localStorage.getItem(AI_CONFIG_KEY);
    return config ? JSON.parse(config) : null;
  } catch (e) {
    return null;
  }
}

// 保存 AI 配置
function saveAiConfig() {
  const baseUrl = document.getElementById("aiBaseUrl").value.trim();
  const apiKey = document.getElementById("aiApiKey").value.trim();
  const model = document.getElementById("aiModel").value.trim();
  const temperature = parseFloat(
    document.getElementById("aiTemperature").value,
  );

  if (!baseUrl || !apiKey) {
    showToast("请填写 API Base URL 和 API Key");
    return;
  }

  const config = {
    baseUrl,
    apiKey,
    model: model || "gpt-4o-mini",
    temperature,
  };
  localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));

  updateAiConfigUI();
  showToast("AI 配置已保存");
}

// 清除 AI 配置
function clearAiConfig() {
  localStorage.removeItem(AI_CONFIG_KEY);
  localStorage.removeItem(AI_ENABLED_KEY);
  localStorage.removeItem("aiScoringEnabled");

  document.getElementById("aiBaseUrl").value = "";
  document.getElementById("aiApiKey").value = "";
  document.getElementById("aiModel").value = "";
  document.getElementById("aiTemperature").value = "0.1";
  document.getElementById("aiTempValue").textContent = "0.1";

  const dropdown = document.getElementById("aiModelDropdown");
  dropdown.innerHTML = "";
  dropdown.style.display = "none";
  _modelList = [];

  updateAiConfigUI();
  showToast("AI 配置已清除");
}

// 测试 AI 连接
async function testAiConfig() {
  const baseUrl = document.getElementById("aiBaseUrl").value.trim();
  const apiKey = document.getElementById("aiApiKey").value.trim();
  const model =
    document.getElementById("aiModel").value.trim() || "gpt-4o-mini";

  if (!baseUrl || !apiKey) {
    showToast("请先填写 API Base URL 和 API Key");
    return;
  }

  showPersistentToast("正在测试连接...");

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 5,
        }),
      },
      15000,
    );

    if (response.ok) {
      dismissPersistentToast("连接成功！");
    } else {
      const error = await response.json().catch(() => ({}));
      dismissPersistentToast(
        `连接失败: ${error.error?.message || response.status}`,
      );
    }
  } catch (e) {
    dismissPersistentToast(`连接失败: ${e.message}`);
  }
}

// 获取可用模型列表
let _modelList = []; // 缓存已获取的模型列表

async function fetchModelList() {
  const baseUrl = document.getElementById("aiBaseUrl").value.trim();
  const apiKey = document.getElementById("aiApiKey").value.trim();

  if (!baseUrl || !apiKey) {
    showToast("请先填写 API 地址和密钥");
    return;
  }

  showToast("正在获取模型列表...");

  try {
    const url = baseUrl.replace(/\/+$/, "") + "/models";
    const response = await fetchWithTimeout(
      url,
      { headers: { Authorization: `Bearer ${apiKey}` } },
      15000,
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      showToast(`获取模型列表失败: ${error.error?.message || response.status}`);
      return;
    }

    const result = await response.json();
    _modelList = (result.data || [])
      .map((m) => m.id)
      .sort((a, b) => a.localeCompare(b));

    if (_modelList.length === 0) {
      showToast("未找到可用模型");
      return;
    }

    showToast(`已获取 ${_modelList.length} 个模型`);
    filterModelList();
    showModelDropdown();
  } catch (e) {
    showToast(`获取模型列表失败: ${e.message}`);
  }
}

// 根据输入过滤并渲染下拉列表
function filterModelList() {
  const dropdown = document.getElementById("aiModelDropdown");
  if (_modelList.length === 0) return;

  const keyword = document.getElementById("aiModel").value.trim().toLowerCase();
  const filtered = keyword
    ? _modelList.filter((id) => id.toLowerCase().includes(keyword))
    : _modelList;

  dropdown.innerHTML = "";
  if (filtered.length === 0) {
    dropdown.innerHTML =
      '<div style="padding: 8px 14px; color: var(--text-muted); font-size: 13px;">无匹配模型</div>';
  } else {
    filtered.forEach((id) => {
      const item = document.createElement("div");
      item.textContent = id;
      item.style.cssText =
        "padding: 8px 14px; cursor: pointer; font-size: 13px; transition: background 0.15s;";
      item.onmouseenter = () =>
        (item.style.background = "var(--hover-bg, rgba(139,92,246,0.08))");
      item.onmouseleave = () => (item.style.background = "");
      item.onmousedown = (e) => {
        e.preventDefault(); // 防止 input 失焦
        document.getElementById("aiModel").value = id;
        hideModelDropdown();
      };
      dropdown.appendChild(item);
    });
  }
}

// 显示/隐藏下拉列表
function showModelDropdown() {
  if (_modelList.length === 0) return;
  filterModelList();
  document.getElementById("aiModelDropdown").style.display = "block";
}

function hideModelDropdown() {
  document.getElementById("aiModelDropdown").style.display = "none";
}

// 更新 AI 配置 UI
function updateAiConfigUI() {
  const config = loadAiConfig();
  const statusEl = document.getElementById("aiConfigStatus");
  const modalStatusEl = document.getElementById("aiConfigModalStatus");
  const checkbox = document.getElementById("useAiParsing");
  const scoringCheckbox = document.getElementById("useAiScoring");
  const enabled = localStorage.getItem(AI_ENABLED_KEY) === "true";
  const scoringEnabled = localStorage.getItem("aiScoringEnabled") === "true";

  // 更新状态元素的辅助函数
  const updateStatusEl = (el, isConfigured, modelName) => {
    if (!el) return;
    if (isConfigured) {
      el.className = "ai-status configured";
      el.innerHTML = `<span class="ai-status-dot"></span><span>已配置: ${modelName}</span>`;
    } else {
      el.className = "ai-status not-configured";
      el.innerHTML = `<span class="ai-status-dot"></span><span>未配置 API</span>`;
    }
  };

  if (config && config.apiKey) {
    const modelName = config.model || "gpt-4o-mini";
    updateStatusEl(statusEl, true, modelName);
    updateStatusEl(modalStatusEl, true, modelName);
    checkbox.disabled = false;
    checkbox.checked = enabled;
    scoringCheckbox.disabled = false;
    scoringCheckbox.checked = scoringEnabled;

    // 填充表单
    document.getElementById("aiBaseUrl").value = config.baseUrl || "";
    document.getElementById("aiApiKey").value = config.apiKey || "";
    document.getElementById("aiModel").value = config.model || "gpt-4o-mini";
    document.getElementById("aiTemperature").value = config.temperature ?? 0.1;
    document.getElementById("aiTempValue").textContent =
      config.temperature ?? 0.1;
  } else {
    updateStatusEl(statusEl, false);
    updateStatusEl(modalStatusEl, false);
    checkbox.disabled = true;
    checkbox.checked = false;
    scoringCheckbox.disabled = true;
    scoringCheckbox.checked = false;
  }
}

// 打开 AI 配置弹窗
function openAiConfigModal() {
  updateAiConfigUI();
  document.getElementById("aiConfigModal").classList.add("show");
  document.body.style.overflow = "hidden";
}

// 关闭 AI 配置弹窗
function closeAiConfigModal() {
  document.getElementById("aiConfigModal").classList.remove("show");
  document.body.style.overflow = "";
}

// AI 解析引用
async function parseWithAI(raw) {
  const config = loadAiConfig();
  if (!config || !config.apiKey) {
    return null;
  }

  const prompt = `请解析以下学术引用，提取字段并以 JSON 格式返回。只返回 JSON，不要其他内容。

引用文本：
${raw}

请提取以下字段（如果无法识别则设为 null）：
- title: 论文/书籍标题
- authors: 作者列表（数组格式，如 ["张三", "李四"]）
- year: 发表年份（数字）
- journal: 期刊名或出版社
- volume: 卷号
- issue: 期号
- firstPage: 起始页码
- lastPage: 结束页码

返回格式示例：
{"title": "...", "authors": ["..."], "year": 2020, "journal": "...", "volume": "1", "issue": "2", "firstPage": "10", "lastPage": "20"}`;

  try {
    const response = await fetchWithTimeout(
      `${config.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model || "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: config.temperature ?? 0.1,
        }),
      },
      30000,
    );

    if (!response.ok) {
      console.error("AI 解析失败:", response.status);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // 提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      // AI 不识别 DOI，用规则从原始文本兜底匹配
      const doiMatch = raw.match(/\b(10\.\d{4,9}\/[^\s,;"\]>]+)/i);
      const doi = doiMatch ? doiMatch[1].replace(/[.,;>\]]+$/, "") : null;

      return {
        raw: raw,
        title: parsed.title || null,
        authors: Array.isArray(parsed.authors) ? parsed.authors : [],
        year: parsed.year ? parseInt(parsed.year, 10) : null,
        journal: parsed.journal || null,
        volume: parsed.volume ? String(parsed.volume) : null,
        issue: parsed.issue ? String(parsed.issue) : null,
        firstPage: parsed.firstPage ? String(parsed.firstPage) : null,
        lastPage: parsed.lastPage ? String(parsed.lastPage) : null,
        doi,
        format: "AI 解析",
      };
    }
  } catch (e) {
    console.error("AI 解析错误:", e);
  }

  return null;
}

