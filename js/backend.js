/** ---------- BibTeX 生成 ---------- */
// 仅基于解析的引用生成 BibTeX（不调用 API）
function generateBibTeXFromParsed(parsed) {
  const type = parsed.journal ? "article" : "book";
  const year = parsed.year || "n.d.";
  const title = parsed.title || "";
  const journal = parsed.journal || "";
  const volume = parsed.volume || "";
  const number = parsed.issue || "";
  const pages =
    parsed.firstPage && parsed.lastPage
      ? `${parsed.firstPage}--${parsed.lastPage}`
      : parsed.firstPage || "";

  const doi = parsed.doi || "";
  const url = doi ? `https://doi.org/${doi}` : "";

  // 处理作者
  const authors = (parsed.authors || []).map((a) => {
    // 假设作者已经是姓氏格式，直接使用
    return a;
  });

  const authorStr = authors.length > 0 ? authors.join(" and\n  ") : "";

  // 生成 citation key（只保留字母数字下划线）
  let firstAuthor = authors[0] || "Unknown";
  if (firstAuthor.includes(",")) firstAuthor = firstAuthor.split(",")[0].trim();
  const cleanAuthor = firstAuthor.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "");
  const firstWord = (title || "").split(/\s+/)[0] || "";
  const cleanWord = firstWord.replace(/[^a-zA-Z0-9]/g, "");
  const citeKey = `${cleanAuthor}${year}${cleanWord}`;

  let bibtex = `@${type}{${citeKey},
`;

  if (authorStr)
    bibtex += `  author = {${authorStr}},
`;
  if (title)
    bibtex += `  title = {${title}},
`;
  if (journal)
    bibtex += `  journal = {${journal}},
`;
  if (year)
    bibtex += `  year = {${year}},
`;
  if (volume)
    bibtex += `  volume = {${volume}},
`;
  if (number)
    bibtex += `  number = {${number}},
`;
  if (pages)
    bibtex += `  pages = {${pages}},
`;
  if (doi)
    bibtex += `  doi = {${doi}},
`;
  if (url)
    bibtex += `  url = {${url}},
`;

  // 移除末尾逗号
  bibtex = bibtex.replace(/,\n$/, "\n");
  bibtex += "}";

  return bibtex;
}

// 从 OpenAlex/Crossref 数据生成 BibTeX
function generateBibTeX(result) {
  const { parsed, oaBest, crBest } = result;
  const oa = oaBest?.best;
  const cr = crBest?.best;

  // 优先使用 API 返回的原始 BibTeX
  const rawBib = oa?.biblio?.raw || cr?.["bibliographic-metadata"]?.raw;
  if (rawBib && typeof rawBib === "string" && rawBib.trim().startsWith("@")) {
    // 提取 citation key
    const entryMatch = rawBib.match(/@(\w+)\s*\{([^,]+),/);
    if (entryMatch) {
      return rawBib.trim();
    }
  }

  // 自行构建 BibTeX
  const type = parsed.journal ? "article" : "book";
  const year =
    oa?.publication_year ||
    cr?.issued?.["date-parts"]?.[0]?.[0] ||
    parsed.year ||
    "n.d.";
  const title = oa?.title || cr?.title?.[0] || parsed.title || "";

  // 提取作者
  let authors = [];
  if (oa?.authorships) {
    authors = oa.authorships.map((a) => {
      const name = a.author?.display_name || "";
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) {
        const last = parts[parts.length - 1];
        const first = parts.slice(0, -1).join(" ");
        return `${last}, ${first}`;
      }
      return name;
    });
  } else if (cr?.author) {
    authors = cr.author
      .map((a) => {
        const family = a.family || "";
        const given = a.given || "";
        return family ? (given ? `${family}, ${given}` : family) : "";
      })
      .filter(Boolean);
  } else if (parsed.authors?.length) {
    authors = parsed.authors;
  }

  const authorStr = authors.length > 0 ? authors.join(" and\n  ") : "";

  const journal =
    oa?.primary_location?.source?.display_name ||
    cr?.["container-title"]?.[0] ||
    parsed.journal ||
    "";

  const volume = oa?.biblio?.volume || cr?.volume || parsed.volume || "";
  const number = oa?.biblio?.issue || cr?.issue || parsed.issue || "";
  const pages =
    oa?.biblio?.first_page && oa?.biblio?.last_page
      ? `${oa.biblio.first_page}--${oa.biblio.last_page}`
      : cr?.page || parsed.firstPage
        ? parsed.firstPage && parsed.lastPage
          ? `${parsed.firstPage}--${parsed.lastPage}`
          : cr?.page || ""
        : "";

  const doi = oa?.doi || cr?.DOI || parsed.doi || "";
  const url = oa?.id || (doi ? `https://doi.org/${doi}` : "");

  // 生成 citation key: 第一作者姓氏+年份+首词（只保留字母数字下划线）
  let firstAuthor = authors[0] || "";
  if (firstAuthor.includes(",")) {
    firstAuthor = firstAuthor.split(",")[0].trim();
  }
  const cleanAuthor = firstAuthor.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "");
  const firstWord = (title || "").split(/\s+/)[0] || "";
  const cleanWord = firstWord.replace(/[^a-zA-Z0-9]/g, "");
  const citeKey = `${cleanAuthor}${year}${cleanWord}`;

  let bibtex = `@${type}{${citeKey},
`;

  if (authorStr)
    bibtex += `  author = {${authorStr}},
`;
  if (title)
    bibtex += `  title = {${title}},
`;
  if (journal)
    bibtex += `  journal = {${journal}},
`;
  if (year)
    bibtex += `  year = {${year}},
`;
  if (volume)
    bibtex += `  volume = {${volume}},
`;
  if (number)
    bibtex += `  number = {${number}},
`;
  if (pages)
    bibtex += `  pages = {${pages}},
`;
  if (doi)
    bibtex += `  doi = {${doi}},
`;
  if (url)
    bibtex += `  url = {${url}},
`;

  // 移除末尾逗号
  bibtex = bibtex.replace(/,\n$/, "\n");
  bibtex += "}";

  return bibtex;
}

/** ---------- API 查询 ---------- */
async function queryOpenAlex(p, mailto, isArxiv) {
  let url = new URL("https://api.openalex.org/works");
  url.searchParams.set("per-page", "5");
  if (mailto) url.searchParams.set("mailto", mailto);

  if (p.doi) {
    url.searchParams.set("filter", `doi:${p.doi.toLowerCase()}`);
  } else {
    url.searchParams.set("search", p.title || p.raw);
    if (isArxiv) {
      url.searchParams.set("filter", "indexed_in:arxiv");
    }
  }

  const doFetch = async (fetchUrl) => {
    const r = await fetch(fetchUrl.toString());
    if (r.status === 429) {
      const retryAfter = parseInt(r.headers.get("Retry-After") || "5", 10);
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      const retryR = await fetch(fetchUrl.toString());
      if (!retryR.ok) throw new Error("OpenAlex 请求失败: " + retryR.status);
      return await retryR.json();
    }
    if (!r.ok) throw new Error("OpenAlex 请求失败: " + r.status);
    return await r.json();
  };

  const data = await doFetch(url);

  // 回退重试：如果结果为空且之前用的是解析标题，用原始文本重试
  if (
    !p.doi &&
    data.results?.length === 0 &&
    p.title &&
    p.raw &&
    p.title !== p.raw
  ) {
    const retryUrl = new URL("https://api.openalex.org/works");
    retryUrl.searchParams.set("per-page", "5");
    if (mailto) retryUrl.searchParams.set("mailto", mailto);
    retryUrl.searchParams.set("search", p.raw.slice(0, 200));
    if (isArxiv) retryUrl.searchParams.set("filter", "indexed_in:arxiv");
    const retryData = await doFetch(retryUrl);
    if (retryData.results?.length > 0) return retryData;
  }

  return data;
}

async function queryCrossref(p, mailto, isArxiv) {
  // arXiv 引用跳过 Crossref 查询（Crossref 对 arXiv 预印本收录不全）
  if (isArxiv && !p.doi) {
    return { message: { items: [] } };
  }

  // DOI：精确取回
  if (p.doi) {
    const doiEnc = encodeURIComponent(p.doi.toLowerCase());
    const url = new URL(`https://api.crossref.org/works/${doiEnc}`);
    if (mailto) url.searchParams.set("mailto", mailto);

    const r = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (r.status === 429) {
      const retryAfter = parseInt(r.headers.get("Retry-After") || "5", 10);
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      const retryR = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });
      if (!retryR.ok)
        throw new Error("Crossref DOI 精确查询失败: " + retryR.status);
      const one = await retryR.json();
      return { message: { items: [one.message] } };
    }

    if (!r.ok) throw new Error("Crossref DOI 精确查询失败: " + r.status);

    const one = await r.json();
    return { message: { items: [one.message] } };
  }

  // 无标题且无 DOI 时，直接返回空结果（避免返回随机结果）
  if (!p.title && !p.raw) {
    return { message: { items: [] } };
  }

  const doFetch = async (query) => {
    let url = new URL("https://api.crossref.org/works");
    url.searchParams.set("rows", "5");
    if (mailto) url.searchParams.set("mailto", mailto);
    if (query) url.searchParams.set("query.bibliographic", query);

    const r = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (r.status === 429) {
      const retryAfter = parseInt(r.headers.get("Retry-After") || "5", 10);
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      const retryR = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });
      if (!retryR.ok) throw new Error("Crossref 请求失败: " + retryR.status);
      return await retryR.json();
    }

    if (!r.ok) throw new Error("Crossref 请求失败: " + r.status);
    return await r.json();
  };

  // 第一次查询：使用解析标题
  const data = await doFetch(p.title || p.raw.slice(0, 150));

  // 回退重试：结果为空时用原始文本重试
  if (
    data.message?.items?.length === 0 &&
    p.title &&
    p.raw &&
    p.title !== p.raw
  ) {
    const retryData = await doFetch(p.raw.slice(0, 150));
    if (retryData.message?.items?.length > 0) return retryData;
  }

  return data;
}

/** ---------- 打分 ---------- */
// arXiv 专用评分（移除期刊、卷期页码）
function scoreOpenAlexWorkArxiv(p, w) {
  const yearDiff =
    p.year && w.publication_year ? Math.abs(p.year - w.publication_year) : null;
  const scores = {
    title: jaccard(p.title, w.title || ""),
    year: yearDiff === null ? 0 : yearDiff === 0 ? 1 : yearDiff === 1 ? 0.5 : 0,
    author: authorSimilarity(p.authors, w.authorships || [], p.raw),
  };

  const weights = getActiveWeights(true);
  let total = 0;
  const details = {};
  for (const field of Object.keys(scores)) {
    const s = scores[field] ?? 0;
    const wt = weights[field] ?? 0;
    total += wt * s;
    details[field] = { score: s, weight: wt, weighted: wt * s };
  }

  return { total, details };
}

function scoreOpenAlexWork(p, w) {
  const yearDiff =
    p.year && w.publication_year ? Math.abs(p.year - w.publication_year) : null;
  const scores = {
    title: jaccard(p.title, w.title || ""),
    year: yearDiff === null ? 0 : yearDiff === 0 ? 1 : yearDiff === 1 ? 0.5 : 0,
    journal: journalSimilarity(
      p.journal,
      w.primary_location?.source?.display_name || "",
    ),
    volume:
      p.volume &&
      w.biblio?.volume &&
      String(w.biblio.volume) === String(p.volume)
        ? 1
        : 0,
    issue:
      p.issue && w.biblio?.issue && String(w.biblio.issue) === String(p.issue)
        ? 1
        : 0,
    firstPage: (() => {
      if (!p.firstPage || !w.biblio?.first_page) return 0;
      return String(w.biblio.first_page) === String(p.firstPage) ? 1 : 0;
    })(),
    lastPage: (() => {
      if (!p.lastPage || !w.biblio?.last_page) return 0;
      const apiLast = String(w.biblio.last_page);
      const pLast = String(p.lastPage);
      if (apiLast === pLast) return 1;

      // 展开 parsed 侧缩写页码
      let expandedParsed = pLast;
      if (p.firstPage && pLast.length < String(p.firstPage).length) {
        expandedParsed =
          String(p.firstPage).slice(
            0,
            String(p.firstPage).length - pLast.length,
          ) + pLast;
      }
      // 展开 API 侧缩写页码
      let expandedApi = apiLast;
      if (
        w.biblio?.first_page &&
        apiLast.length < String(w.biblio.first_page).length
      ) {
        expandedApi =
          String(w.biblio.first_page).slice(
            0,
            String(w.biblio.first_page).length - apiLast.length,
          ) + apiLast;
      }

      // 对称比较所有组合
      if (
        apiLast === expandedParsed ||
        expandedApi === pLast ||
        expandedApi === expandedParsed
      )
        return 1;
      return 0;
    })(),
    author: authorSimilarity(p.authors, w.authorships || [], p.raw),
  };

  const weights = getActiveWeights(false);
  let total = 0;
  const details = {};
  for (const field of Object.keys(scores)) {
    const s = scores[field] ?? 0;
    const wt = weights[field] ?? 0;
    total += wt * s;
    details[field] = { score: s, weight: wt, weighted: wt * s };
  }

  return { total, details };
}

// arXiv 专用 Crossref 评分（移除期刊、卷期页码）
function scoreCrossrefItemArxiv(p, it) {
  const title = it.title && it.title[0] ? it.title[0] : "";
  const issuedYear = it.issued?.["date-parts"]?.[0]?.[0];
  const yearDiff = p.year && issuedYear ? Math.abs(p.year - issuedYear) : null;

  const scores = {
    title: jaccard(p.title, title),
    year: yearDiff === null ? 0 : yearDiff === 0 ? 1 : yearDiff === 1 ? 0.5 : 0,
    author: authorSimilarity(p.authors, it.author || [], p.raw),
  };

  const weights = getActiveWeights(true);
  let total = 0;
  const details = {};
  for (const field of Object.keys(scores)) {
    const s = scores[field] ?? 0;
    const wt = weights[field] ?? 0;
    total += wt * s;
    details[field] = { score: s, weight: wt, weighted: wt * s };
  }

  return { total, details };
}

function scoreCrossrefItem(p, it) {
  const title = it.title && it.title[0] ? it.title[0] : "";
  const container =
    it["container-title"] && it["container-title"][0]
      ? it["container-title"][0]
      : "";
  const issuedYear = it.issued?.["date-parts"]?.[0]?.[0];
  const yearDiff = p.year && issuedYear ? Math.abs(p.year - issuedYear) : null;
  const page = it.page || "";

  // 处理缩写页码（如 1818-59 → 1818-1859）
  let expandedLastPage = p.lastPage;
  if (p.firstPage && p.lastPage && p.lastPage.length < p.firstPage.length) {
    expandedLastPage =
      p.firstPage.slice(0, p.firstPage.length - p.lastPage.length) + p.lastPage;
  }

  const scores = {
    title: jaccard(p.title, title),
    journal: journalSimilarity(p.journal, container),
    year: yearDiff === null ? 0 : yearDiff === 0 ? 1 : yearDiff === 1 ? 0.5 : 0,
    author: authorSimilarity(p.authors, it.author || [], p.raw),
    volume:
      p.volume && it.volume && String(it.volume) === String(p.volume) ? 1 : 0,
    issue: p.issue && it.issue && String(it.issue) === String(p.issue) ? 1 : 0,
    firstPage: (() => {
      if (!p.firstPage || !page) return 0;
      // 解析 API 的 page 字段为起止页码精确比较
      const pageParts = page.split(/[-–—]/);
      const apiFirst = pageParts[0]?.trim();
      return String(apiFirst) === String(p.firstPage) ? 1 : 0;
    })(),
    lastPage: (() => {
      if (!p.lastPage || !page) return 0;
      const pageParts = page.split(/[-–—]/);
      const apiFirst = pageParts[0]?.trim();
      let apiLast =
        pageParts.length > 1 ? pageParts[pageParts.length - 1]?.trim() : null;
      if (!apiLast) return 0;

      // 展开双方的缩写页码以进行对称比较
      // 展开 API 侧：apiFirst=1818, apiLast=59 → apiLast=1859
      let expandedApiLast = apiLast;
      if (apiFirst && apiLast.length < apiFirst.length) {
        expandedApiLast =
          apiFirst.slice(0, apiFirst.length - apiLast.length) + apiLast;
      }

      // 比较：直接匹配、展开 parsed 侧、展开 API 侧
      const pLast = String(p.lastPage);
      const eLast = expandedLastPage ? String(expandedLastPage) : pLast;
      if (String(apiLast) === pLast || String(apiLast) === eLast) return 1;
      if (
        String(expandedApiLast) === pLast ||
        String(expandedApiLast) === eLast
      )
        return 1;
      return 0;
    })(),
  };

  const weights = getActiveWeights(false);
  let total = 0;
  const details = {};
  for (const field of Object.keys(scores)) {
    const s = scores[field] ?? 0;
    const wt = weights[field] ?? 0;
    total += wt * s;
    details[field] = { score: s, weight: wt, weighted: wt * s };
  }

  return { total, details };
}

function getVerdict(score) {
  if (score >= 0.78) return { level: "high", text: "高可信", desc: "强匹配" };
  if (score >= 0.55) return { level: "medium", text: "中可信", desc: "需核对" };
  return { level: "low", text: "低可信", desc: "可能伪造" };
}

/** ---------- 重算评分（字段启用状态变更时） ---------- */

// 根据 details 中保存的原始 score 和当前活跃权重重新计算加权总分
function recalcWeightedTotal(details, isArxiv) {
  if (!details) return { total: 0, details: null };
  const weights = getActiveWeights(isArxiv);
  let total = 0;
  const newDetails = {};
  for (const [field, val] of Object.entries(details)) {
    const s = val.score ?? 0;
    const wt = weights[field] ?? 0;
    total += wt * s;
    newDetails[field] = { score: s, weight: wt, weighted: wt * s };
  }
  return { total, details: newDetails };
}

// 重算单个 result 的评分并更新其字段
function recalcResultScores(result) {
  if (!result) return;
  const isArxiv = result.isArxiv || false;

  // 重算 OpenAlex 规则评分
  if (result.oaBest?.bestDetails) {
    const recalc = recalcWeightedTotal(result.oaBest.bestDetails, isArxiv);
    result.oaBest.bestScore = recalc.total;
    result.oaBest.bestDetails = recalc.details;
  }
  const oaRuleScore = result.oaBest?.bestScore || 0;

  // 重算 Crossref 规则评分
  if (result.crBest?.bestDetails) {
    const recalc = recalcWeightedTotal(result.crBest.bestDetails, isArxiv);
    result.crBest.bestScore = recalc.total;
    result.crBest.bestDetails = recalc.details;
  }
  const crRuleScore = result.crBest?.bestScore || 0;

  // 综合评分（max(规则, AI)）
  result.oaScore = Math.max(oaRuleScore, result.oaBest?.aiScore || 0);
  result.crScore = Math.max(crRuleScore, result.crBest?.aiScore || 0);

  const highSource = result.oaScore >= result.crScore ? "openAlex" : "crossref";
  result.combined = Math.max(result.oaScore, result.crScore);
  result.combinedDetails = {
    openAlex: {
      score: result.oaScore,
      weight: highSource === "openAlex" ? 1.0 : 0,
      weighted: highSource === "openAlex" ? result.oaScore : 0,
    },
    crossref: {
      score: result.crScore,
      weight: highSource === "crossref" ? 1.0 : 0,
      weighted: highSource === "crossref" ? result.crScore : 0,
    },
  };
  result.verdict = getVerdict(result.combined);
}

// 刷新所有已有结果的评分和 UI
function refreshAllResults() {
  const results = window.currentResults;
  if (!results || results.length === 0) return;

  for (let i = 0; i < results.length; i++) {
    recalcResultScores(results[i]);
    const item = document.querySelector(`.result-item[data-index="${i}"]`);
    if (item) {
      const newHtml = renderResult(results[i], i);
      const temp = document.createElement("div");
      temp.innerHTML = newHtml;
      const newItem = temp.firstElementChild;
      item.replaceWith(newItem);
    }
  }

  // 更新统计摘要
  updateStats(results);
}

