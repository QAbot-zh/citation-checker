/** ---------- 单条校验 ---------- */
async function verifySingle(raw, mailto) {
  // 检查是否启用 AI 解析
  const useAi = localStorage.getItem(AI_ENABLED_KEY) === "true";
  const useAiScoring = localStorage.getItem("aiScoringEnabled") === "true";
  let p;

  if (useAi) {
    // 尝试 AI 解析
    p = await parseWithAI(raw);
    if (!p) {
      // AI 解析失败，回退到规则解析
      p = parseCitation(raw);
    }
  } else {
    p = parseCitation(raw);
  }

  // 外部检测是否是 arXiv 相关引用（传入两个 query 函数）
  const isArxiv = detectArxiv(raw);

  const [oa, cr] = await Promise.all([
    queryOpenAlex(p, mailto, isArxiv).catch((e) => ({
      __error: e.message,
    })),
    queryCrossref(p, mailto, isArxiv).catch((e) => ({
      __error: e.message,
    })),
  ]);

  const oaItems = oa?.results || [];
  const crItems = cr?.message?.items || [];

  // 根据是否是 arXiv 选择评分函数
  const oaScoreFn = isArxiv ? scoreOpenAlexWorkArxiv : scoreOpenAlexWork;
  const crScoreFn = isArxiv ? scoreCrossrefItemArxiv : scoreCrossrefItem;

  const oaBest = pickBest(oaItems, (w) => oaScoreFn(p, w));
  const crBest = pickBest(crItems, (it) => crScoreFn(p, it));

  let oaRuleScore = oaBest?.best ? oaBest.bestScore : 0;
  let crRuleScore = crBest?.best ? crBest.bestScore : 0;
  let aiScoringResult = null;

  // 如果启用 AI 评分，调用 AI 进行评分（scoreWithAI 内部已有 30s 超时）
  if (useAiScoring && (oaBest?.best || crBest?.best)) {
    try {
      aiScoringResult = await scoreWithAI(
        raw,
        p,
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

  return {
    raw,
    parsed: p,
    oaBest,
    crBest,
    oaScore,
    crScore,
    combined,
    combinedDetails,
    verdict: getVerdict(combined),
    isArxiv, // 标记是否为 arXiv 引用
    useAiScoring: aiScoringResult !== null, // 标记是否使用了 AI 评分
  };
}


/** ---------- 智能分割引用条目 ---------- */
function smartSplitCitations(text) {
  const entries = [];

  // 快速路径：显式编号前缀 [1], [2]... 直接按前缀切割，合并内部换行
  if (/^\s*\[\d+\]/m.test(text)) {
    let currentEntry = "";
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (/^\[\d+\]/.test(trimmed)) {
        if (currentEntry.trim()) entries.push(currentEntry.trim());
        currentEntry = trimmed;
      } else if (trimmed) {
        currentEntry = joinLines(currentEntry, trimmed);
      }
    }
    if (currentEntry.trim()) entries.push(currentEntry.trim());
    return entries;
  }

  const lines = text.split("\n");
  let currentEntry = "";
  let inBibTeX = false;
  let braceCount = 0;

  for (let line of lines) {
    const trimmed = line.trim();

    // 检测 BibTeX 开始
    if (trimmed.startsWith("@")) {
      // 如果之前有未完成的条目，先保存
      if (currentEntry.trim()) {
        entries.push(currentEntry.trim());
      }
      currentEntry = line;
      inBibTeX = true;
      braceCount =
        (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
    } else if (inBibTeX) {
      // 在 BibTeX 条目中，继续累积
      currentEntry += "\n" + line;
      braceCount +=
        (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

      // 检查是否完成（大括号匹配）
      if (braceCount <= 0) {
        entries.push(currentEntry.trim());
        currentEntry = "";
        inBibTeX = false;
      }
    } else {
      // 普通引用：使用 detectNewEntry 智能合并多行
      if (!trimmed) {
        // 空行：结束当前条目
        if (currentEntry.trim()) {
          entries.push(currentEntry.trim());
          currentEntry = "";
        }
        continue;
      }

      if (detectNewEntry(trimmed, currentEntry ? [currentEntry] : [])) {
        // 新条目开始
        if (currentEntry.trim()) {
          entries.push(currentEntry.trim());
        }
        currentEntry = trimmed;
      } else {
        // 续行：合并到当前条目（处理连字符断词）
        currentEntry = joinLines(currentEntry, trimmed);
      }
    }
  }

  // 处理最后一个条目
  if (currentEntry.trim()) {
    entries.push(currentEntry.trim());
  }

  return entries;
}

/** ---------- 引用计数显示 ---------- */
let citationFormatted = false;
let _citationCountTimer = null;

function updateCitationCount() {
  const text = document.getElementById("citation").value;
  const el = document.getElementById("citationCount");
  if (!text.trim()) { el.innerHTML = ""; el.className = "citation-count"; return; }
  const count = smartSplitCitations(text).length;
  if (citationFormatted) {
    el.innerHTML = `检测到 <span class="citation-count-num ok">${count}</span> 条引用（已整理）`;
    el.className = "citation-count";
  } else {
    el.innerHTML = `检测到 <span class="citation-count-num">${count}</span> 条引用<span class="citation-count-hint">，如数量不符建议手动整理或使用 AI 辅助整理引用</span>`;
    el.className = "citation-count";
  }
}

/** ---------- 文本整理功能 ---------- */
function formatCitationText(text) {
  // 1. 标准化引号
  text = text
    .replace(/[“”„‟«»＂〝〞]/g, '"') // 各种双引号 → "
    .replace(/[‘’‚‛＇`´]/g, "'"); // 各种单引号 → '

  // 2. 标准化破折号
  text = text.replace(/[–—−‐‑‒―]/g, "-");

  // 3. 移除行首行尾空白，保留换行结构
  let lines = text.split("\n").map((l) => l.trim());

  // 4. 智能识别条目边界并合并
  const entries = [];

  // 快速路径：显式编号前缀 [1], [2]... 直接按前缀切割
  const hasNumberedPrefix = lines.some((l) => /^\[\d+\]/.test(l));
  if (hasNumberedPrefix) {
    let currentEntry = "";
    for (const line of lines) {
      if (!line) continue;
      if (/^\[\d+\]/.test(line)) {
        if (currentEntry.trim()) entries.push(currentEntry.trim());
        currentEntry = line;
      } else {
        currentEntry = joinLines(currentEntry, line);
      }
    }
    if (currentEntry.trim()) entries.push(currentEntry.trim());
  } else {
    let currentEntry = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 空行表示条目分隔
    if (!line) {
      if (currentEntry.length > 0) {
        entries.push(currentEntry.join(" "));
        currentEntry = [];
      }
      continue;
    }

    // 检测是否是新条目的开始
    const isNewEntry = detectNewEntry(line, currentEntry);

    if (isNewEntry && currentEntry.length > 0) {
      // 保存当前条目，开始新条目
      entries.push(currentEntry.join(" "));
      currentEntry = [line];
    } else {
      // 继续当前条目
      currentEntry.push(line);
    }
  }

  // 处理最后一个条目
  if (currentEntry.length > 0) {
    entries.push(currentEntry.join(" "));
  }
  }

  // 5. 清理每个条目
  const cleanedEntries = entries
    .map((entry) => {
      return entry
        .replace(/\s+/g, " ") // 多个空格合并
        .replace(/\s*([,.:;])\s*/g, "$1 ") // 标点后加空格
        .replace(/\s+$/, "") // 移除末尾空格
        .trim();
    })
    .filter((e) => e.length > 0);

  // 条目之间用空行分隔
  return cleanedEntries.join("\n\n");
}

/**
 * 合并两行文本，处理连字符断词
 * 规则：已知构词前缀保留连字符，其余视为排版断词直接拼接
 */
function joinLines(prev, next) {
  if (!prev) return next;

  // 连字符断词检测：上一行以各种连字符/软连字符结尾
  const hyphenRe = /[-\u00AD\u2010\u2011\u2012\u2013\u2014\u2015\u2212]$/;
  if (hyphenRe.test(prev)) {
    const lastWord = prev.slice(prev.lastIndexOf(" ") + 1, -1); // 去掉末尾连字符

    // 已知构词前缀 → 保留连字符 (semi- + supervised → semi-supervised)
    const knownPrefixes =
      /^(self|semi|non|multi|pre|post|re|co|over|under|cross|day|night|depth|real|mono|bi|tri|sub|super|inter|intra|anti|auto|de|dis|mis|out|un|mid|well|high|low|long|short|full|half|near|far|hard|soft|fast|slow|open|end|fine)$/i;
    if (knownPrefixes.test(lastWord)) {
      return prev + next;
    }

    // 默认：排版断词，移除连字符 (estima- + tion → estimation)
    return prev.slice(0, -1) + next;
  }

  // 普通续行：用空格连接
  return prev + " " + next;
}

/**
 * 检测一行是否是新条目的开始
 */
function detectNewEntry(line, currentEntry) {
  if (currentEntry.length === 0) return true;

  // 1. 以序号开头：[1], 1., 1), (1), [1]（排除年份如 (2022)）
  const numMatch = line.match(/^\s*[\[(]?(\d+)[\].):\s]/);
  if (numMatch && parseInt(numMatch[1], 10) < 1000) return true;

  // 2. 上一行以逗号、分号、介词等结尾 → 条目未完成，当前行是续行
  const prevText = currentEntry.join ? currentEntry.join(" ") : currentEntry;
  if (/[,;]\s*$/.test(prevText)) return false;
  if (
    /\b(in|of|on|for|and|the|a|an|with|from|by|to|at|as|or|using|via|based|IEEE|ACM)\s*$/i.test(
      prevText
    )
  )
    return false;

  // 3. 以作者名开头的常见模式
  // 中文作者：2-4个汉字开头
  if (/^[\u4e00-\u9fa5]{2,4}[,，.]/.test(line)) return true;

  // 西方作者：Lastname, F. 或 F. Lastname
  if (/^[A-Z][a-z]+,\s*[A-Z]\./.test(line)) return true;
  if (/^[A-Z]\.\s*[A-Z]?\.?\s*[A-Z][a-z]+/.test(line)) return true;

  // 续行特征：小写字母开头（非新条目）
  if (/^[a-z]/.test(line)) return false;

  // 3. 检查当前条目是否已经"完整"
  const currentText = currentEntry.join(" ");

  // 如果当前条目以常见结束符结尾，新行可能是新条目
  // 结束符：年份+句号、DOI、URL、页码范围+句号
  const endsWithComplete =
    /\(\d{4}\)\s*\.?\s*$/.test(currentText) || // (2020).
    /\d{4}\s*\.?\s*$/.test(currentText) || // 2020.
    /doi[:\s]+10\.\d+\/[^\s]+\s*\.?\s*$/i.test(currentText) || // DOI
    /https?:\/\/[^\s]+\s*\.?\s*$/i.test(currentText) || // URL
    /\d+\s*[-–—]\s*\d+\s*\.?\s*$/.test(currentText); // 页码范围

  if (endsWithComplete) {
    // 当前条目看起来完整，检查新行是否像条目开头
    // 以大写字母或中文开头
    if (/^[A-Z]/.test(line) || /^[\u4e00-\u9fa5]/.test(line)) {
      return true;
    }
  }

  return false;
}
