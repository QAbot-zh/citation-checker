/** ---------- AI 配置常量 ---------- */
const AI_CONFIG_KEY = "citation_checker_ai_config";
const AI_ENABLED_KEY = "citation_checker_ai_enabled";
const CONCURRENCY_KEY = "citation_checker_concurrency";

/** ---------- 字段权重使能控制 ---------- */
const DISABLED_FIELDS_KEY = "disabledScoreFields";
const disabledFields = new Set(
  JSON.parse(localStorage.getItem(DISABLED_FIELDS_KEY) || "[]"),
);

// 原始权重定义
const BASE_WEIGHTS = {
  title: 0.48,
  author: 0.2,
  journal: 0.12,
  year: 0.1,
  volume: 0.04,
  issue: 0.02,
  firstPage: 0.02,
  lastPage: 0.02,
};
const BASE_WEIGHTS_ARXIV = {
  title: 0.6,
  author: 0.25,
  year: 0.15,
};

function getActiveWeights(isArxiv) {
  const base = isArxiv ? BASE_WEIGHTS_ARXIV : BASE_WEIGHTS;
  const active = {};
  let sum = 0;
  for (const [field, w] of Object.entries(base)) {
    if (!disabledFields.has(field)) {
      active[field] = w;
      sum += w;
    }
  }
  // 归一化
  if (sum > 0 && sum !== 1) {
    for (const field of Object.keys(active)) {
      active[field] = active[field] / sum;
    }
  }
  return active;
}

function updateWeightDisplay() {
  const weights = getActiveWeights(false);
  const allFields = Object.keys(BASE_WEIGHTS);
  for (const field of allFields) {
    const el = document.getElementById("field-weight-" + field);
    if (!el) continue;
    if (disabledFields.has(field)) {
      el.textContent = "-";
    } else {
      el.textContent =
        (weights[field] * 100).toFixed(1).replace(/\.0$/, "") + "%";
    }
  }
}

function enableAllFields() {
  const fieldKeys = Object.keys(BASE_WEIGHTS);
  disabledFields.clear();
  localStorage.setItem(DISABLED_FIELDS_KEY, JSON.stringify([]));
  for (const key of fieldKeys) {
    const cb = document.getElementById("field-enable-" + key);
    if (!cb || key === "title") continue;
    cb.checked = true;
    cb.closest("tr").classList.remove("field-disabled");
  }
  updateWeightDisplay();
}

/** ---------- 工具函数 ---------- */
function norm(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[\[\]\(\)\{\},.:;'"`~!@#$%^&*_+=<>?/\\|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) {
  return new Set(norm(s).split(" ").filter(Boolean));
}

function jaccard(a, b) {
  const A = tokens(a),
    B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return inter / union;
}

// 编辑距离（Levenshtein Distance）
function levenshtein(s1, s2) {
  const m = s1.length,
    n = s2.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // 删除
        dp[i][j - 1] + 1, // 插入
        dp[i - 1][j - 1] + cost, // 替换
      );
    }
  }
  return dp[m][n];
}

// 归一化编辑距离相似度（0-1，1为完全相同）
function editSimilarity(a, b) {
  if (!a || !b) return 0;
  const s1 = norm(a),
    s2 = norm(b);
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;
  const dist = levenshtein(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  return 1 - dist / maxLen;
}

// 期刊名相似度（结合多种策略，加权组合）
function journalSimilarity(input, api) {
  if (!input || !api) return 0;

  // 预处理：移除点号、统一小写、去除多余空格
  const cleanInput = input
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
  const cleanApi = api
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();

  // 完全匹配
  if (cleanInput === cleanApi) return 1;

  const inputWords = cleanInput.split(" ").filter(Boolean);
  const apiWords = cleanApi.split(" ").filter(Boolean);

  // 前缀匹配（更严格：要求前缀长度至少3个字符，且匹配比例高）
  let prefixMatches = 0;
  let totalChecked = 0;
  for (const iw of inputWords) {
    if (iw.length < 2) continue; // 跳过太短的词
    totalChecked++;
    for (const aw of apiWords) {
      // 要求前缀长度至少为较短词的60%
      const minPrefixLen = Math.max(
        3,
        Math.floor(Math.min(iw.length, aw.length) * 0.6),
      );
      if (aw.startsWith(iw) || iw.startsWith(aw)) {
        const commonLen = Math.min(iw.length, aw.length);
        if (commonLen >= minPrefixLen) {
          prefixMatches++;
          break;
        }
      }
    }
  }
  // 要求至少80%的词匹配成功
  const prefixScore =
    totalChecked > 0 && prefixMatches / totalChecked >= 0.8
      ? prefixMatches / Math.max(inputWords.length, apiWords.length)
      : 0;

  // 编辑距离相似度
  const editScore = editSimilarity(cleanInput, cleanApi);

  // Jaccard 相似度
  const jaccardScore = jaccard(input, api);

  // 加权组合：编辑距离权重最高，前缀匹配次之，Jaccard 作为补充
  // 如果前缀匹配成功率高，给予额外加成
  const weightedScore =
    editScore * 0.5 + prefixScore * 0.3 + jaccardScore * 0.2;

  // 如果某个策略得分特别高（>0.9），可以适当提升总分
  const maxScore = Math.max(prefixScore, editScore, jaccardScore);
  if (maxScore > 0.9) {
    return Math.min(1, weightedScore * 0.7 + maxScore * 0.3);
  }

  return weightedScore;
}

// 作者相似度（处理缩写情况，加权组合）
// 支持两种输入：数组或字符串
function authorSimilarity(inputAuthors, apiAuthors, rawCitation) {
  if (!inputAuthors?.length || !apiAuthors) return 0;

  // 检测是否是中文名字（全是中文字符）
  const isChinese = (str) => /^[\u4e00-\u9fa5]+$/.test(str.trim());
  // 检测是否包含中文字符
  const hasChinese = (str) => /[\u4e00-\u9fa5]/.test(str);

  // 从单个作者字符串提取姓氏和名字首字母
  const extractSingleAuthor = (authorStr) => {
    if (!authorStr || typeof authorStr !== "string") return null;

    const a = authorStr.trim();
    if (a.length < 2) return null;

    // 中文名字特殊处理
    if (isChinese(a)) {
      // 中文名字：第一个字是姓，后面是名
      return {
        lastName: a[0],
        givenName: a.slice(1),
        fullName: a,
        isChinese: true,
      };
    }

    // OpenAlex 中文名字格式："爽 薛"（名 姓，空格分隔）
    // 检测是否是空格分隔的中文名字
    const spaceParts = a.split(/\s+/);
    if (spaceParts.length === 2 && hasChinese(a)) {
      const [part1, part2] = spaceParts;
      if (isChinese(part1) && isChinese(part2)) {
        // 假设格式是 "名 姓"（OpenAlex 格式）
        // 中文名字通常姓是单字，名是1-2字
        // 如果第二部分是单字，很可能是姓
        if (part2.length === 1 && part1.length >= 1) {
          return {
            lastName: part2,
            givenName: part1,
            fullName: part2 + part1,
            isChinese: true,
          };
        } else if (part1.length === 1 && part2.length >= 1) {
          // 格式是 "姓 名"
          return {
            lastName: part1,
            givenName: part2,
            fullName: part1 + part2,
            isChinese: true,
          };
        }
      }
    }

    const parts = a.split(/\s+/);
    let lastName = "";
    let givenInitials = [];

    // 如果是 "Lastname, Firstname" 格式
    if (a.includes(",")) {
      const [lastPart, firstPart] = a.split(/,\s*/);
      lastName = lastPart.trim().toLowerCase();
      // 提取名字首字母
      if (firstPart) {
        const firstParts = firstPart.trim().split(/\s+/);
        for (const p of firstParts) {
          const clean = p.replace(/\./g, "");
          if (clean.length > 0) givenInitials.push(clean[0].toLowerCase());
        }
      }
    } else {
      // "Firstname Lastname" 或 "F. Lastname" 或 "Smith JA" 格式
      // 检测 "Smith JA" 格式（姓氏后跟大写缩写）
      const lastPart = parts[parts.length - 1];
      if (parts.length >= 2 && /^[A-Z]{1,3}$/.test(lastPart)) {
        // "Smith JA" 格式：最后是缩写，倒数第二个是姓氏
        lastName = parts[parts.length - 2].toLowerCase();
        // 缩写的每个字母都是名字首字母
        for (const c of lastPart) {
          givenInitials.push(c.toLowerCase());
        }
        // 还可能有前面的名字部分
        for (let i = 0; i < parts.length - 2; i++) {
          const p = parts[i].replace(/\./g, "");
          if (p.length > 0) givenInitials.unshift(p[0].toLowerCase());
        }
      } else {
        // 标准 "Firstname Lastname" 格式
        lastName = lastPart.toLowerCase();
        for (let i = 0; i < parts.length - 1; i++) {
          const p = parts[i].replace(/\./g, "");
          if (p.length > 0) givenInitials.push(p[0].toLowerCase());
        }
      }
    }

    if (lastName.length < 2) return null;
    return { lastName, givenInitials, isChinese: false };
  };

  // 从字符串解析多个作者（用于兼容旧的字符串输入）
  const parseAuthorsFromString = (str) => {
    if (!str) return [];

    // 智能分割作者列表
    let authorList = [];

    // 先按 " and " 或 " & " 分割
    const andParts = str.split(/\s+and\s+|\s*&\s*/i).filter(Boolean);

    for (const part of andParts) {
      // 检测是否是 "Lastname, Firstname" 格式
      const commaMatch = part.match(/^([^,]+),\s*([A-Z][^,]*?)$/);
      if (commaMatch) {
        authorList.push(part.trim());
      } else if (part.includes(",")) {
        const commaParts = part.split(/,\s*/);
        let isMultipleAuthors = true;

        if (commaParts.length === 2) {
          const secondPart = commaParts[1].trim();
          if (secondPart.length < 10 && /^[A-Z]/.test(secondPart)) {
            isMultipleAuthors = false;
            authorList.push(part.trim());
          }
        }

        if (isMultipleAuthors) {
          for (const cp of commaParts) {
            if (cp.trim()) authorList.push(cp.trim());
          }
        }
      } else {
        authorList.push(part.trim());
      }
    }

    return authorList.map(extractSingleAuthor).filter(Boolean);
  };

  // 处理输入作者（可能是数组或字符串）
  let inputAuthorsInfo = [];
  if (Array.isArray(inputAuthors)) {
    // 数组：每个元素是一个作者
    inputAuthorsInfo = inputAuthors.map(extractSingleAuthor).filter(Boolean);
  } else {
    // 字符串：需要解析
    inputAuthorsInfo = parseAuthorsFromString(inputAuthors);
  }

  // 处理 API 作者（可能是数组或字符串）
  let apiAuthorsInfo = [];
  if (Array.isArray(apiAuthors)) {
    // 数组：每个元素是一个作者（可能是字符串或对象）
    apiAuthorsInfo = apiAuthors
      .map((a) => {
        if (typeof a === "string") {
          return extractSingleAuthor(a);
        } else if (a && typeof a === "object") {
          // Crossref 格式：{family: "Zhang", given: "Jinglin"}
          // OpenAlex 格式：{author: {display_name: "Jinglin Zhang"}}
          if (a.family) {
            const family = a.family.trim();
            const given = (a.given || "").trim();

            // 检测是否是中文名字
            if (isChinese(family) || isChinese(given)) {
              // 中文名字：family 是姓，given 是名
              return {
                lastName: family,
                givenName: given,
                fullName: family + given,
                isChinese: true,
              };
            }

            // 西方名字
            const lastName = family.toLowerCase();
            const givenInitials = [];
            if (given) {
              // 提取 given name 的首字母
              const givenParts = given.split(/\s+/);
              for (const p of givenParts) {
                const clean = p.replace(/\./g, "");
                if (clean.length > 0)
                  givenInitials.push(clean[0].toLowerCase());
              }
            }
            return { lastName, givenInitials, isChinese: false };
          } else if (a.author?.display_name) {
            return extractSingleAuthor(a.author.display_name);
          } else if (a.display_name) {
            return extractSingleAuthor(a.display_name);
          }
        }
        return null;
      })
      .filter(Boolean);
  } else {
    // 字符串：需要解析
    apiAuthorsInfo = parseAuthorsFromString(apiAuthors);
  }

  if (inputAuthorsInfo.length === 0 || apiAuthorsInfo.length === 0) {
    // 回退到 Jaccard 相似度
    const inputStr = Array.isArray(inputAuthors)
      ? inputAuthors.join(" ")
      : inputAuthors;
    const apiStr = Array.isArray(apiAuthors)
      ? apiAuthors
          .map((a) =>
            typeof a === "string"
              ? a
              : a.family
                ? `${a.given || ""} ${a.family}`
                : a.author?.display_name || "",
          )
          .join(" ")
      : apiAuthors;
    return jaccard(inputStr, apiStr);
  }

  // 作者匹配
  let totalScore = 0;
  let matchedCount = 0;

  for (const inputAuthor of inputAuthorsInfo) {
    let bestMatchScore = 0;

    for (const apiAuthor of apiAuthorsInfo) {
      let score = 0;

      // 中文名字匹配
      if (inputAuthor.isChinese && apiAuthor.isChinese) {
        // 完全匹配
        if (inputAuthor.fullName === apiAuthor.fullName) {
          score = 1.0;
        } else if (inputAuthor.lastName === apiAuthor.lastName) {
          // 姓氏匹配
          score = 0.7;
          // 名字匹配
          if (inputAuthor.givenName && apiAuthor.givenName) {
            if (inputAuthor.givenName === apiAuthor.givenName) {
              score += 0.3;
            } else if (
              inputAuthor.givenName.includes(apiAuthor.givenName) ||
              apiAuthor.givenName.includes(inputAuthor.givenName)
            ) {
              score += 0.2;
            }
          }
        }
      } else if (!inputAuthor.isChinese && !apiAuthor.isChinese) {
        // 西方名字匹配（姓氏 + 名字首字母）
        if (inputAuthor.lastName === apiAuthor.lastName) {
          score += 0.7;
        } else if (
          inputAuthor.lastName.length >= 3 &&
          (apiAuthor.lastName.startsWith(inputAuthor.lastName) ||
            inputAuthor.lastName.startsWith(apiAuthor.lastName))
        ) {
          score += 0.5; // 前缀匹配
        } else if (
          editSimilarity(inputAuthor.lastName, apiAuthor.lastName) > 0.8
        ) {
          score += 0.5; // 高编辑相似度
        }

        // 名字首字母匹配（权重 30%）
        if (
          inputAuthor.givenInitials?.length > 0 &&
          apiAuthor.givenInitials?.length > 0
        ) {
          let initialMatches = 0;
          const minLen = Math.min(
            inputAuthor.givenInitials.length,
            apiAuthor.givenInitials.length,
          );
          for (let i = 0; i < minLen; i++) {
            if (inputAuthor.givenInitials[i] === apiAuthor.givenInitials[i]) {
              initialMatches++;
            }
          }
          // 首字母匹配比例
          const initialScore = initialMatches / minLen;
          score += 0.3 * initialScore;
        } else if (score > 0) {
          // 如果姓氏匹配但没有名字信息，给予部分分数
          score += 0.15;
        }
      }

      bestMatchScore = Math.max(bestMatchScore, score);
    }

    if (bestMatchScore > 0) {
      totalScore += bestMatchScore;
      matchedCount++;
    }
  }

  const totalAuthors = Math.max(inputAuthorsInfo.length, apiAuthorsInfo.length);

  // 检查原始引用中是否有明确的作者截断标记（et al. / 等）
  // 使用上下文感知模式：要求 et al. 出现在作者列表上下文中
  const rawCitationStr = rawCitation || "";
  const hasEtAlMarker =
    // 逗号后跟 et al.（典型作者列表分隔）
    /,\s*et\s+al\.?/i.test(rawCitationStr) ||
    // et al. 后紧跟年份括号（APA/Nature 格式）
    /et\s+al\.?\s*\(?(?:19|20)\d{2}/i.test(rawCitationStr) ||
    // 大写名/缩写后紧跟 et al.（无 /i ，区分大写专有名词和小写普通词）
    /[A-Z][a-z]*\.?\s+et\s+al\./.test(rawCitationStr) ||
    // 中文格式：逗号+等+句号/逗号/类型标记
    /[,，]\s*等\s*[.,。，\[【]/i.test(rawCitationStr);

  // 计算最终得分：处理 et al. 情况
  let authorScore;
  if (totalAuthors > 0) {
    if (
      hasEtAlMarker &&
      inputAuthorsInfo.length < apiAuthorsInfo.length &&
      inputAuthorsInfo.length > 0 &&
      matchedCount === inputAuthorsInfo.length
    ) {
      // 明确的 et al. 截断：输入作者数少于 API，且所有输入作者都匹配了
      // 以输入作者数为分母，但施加轻微罚分
      authorScore = (totalScore / inputAuthorsInfo.length) * 0.85;
    } else {
      authorScore = totalScore / totalAuthors;
    }
  } else {
    authorScore = 0;
  }

  // 原始 Jaccard 作为补充（权重降低）
  const inputStr = Array.isArray(inputAuthors)
    ? inputAuthors.join(" ")
    : inputAuthors;
  const apiStr = Array.isArray(apiAuthors)
    ? apiAuthors
        .map((a) =>
          typeof a === "string"
            ? a
            : a.family
              ? `${a.given || ""} ${a.family}`
              : a.author?.display_name || "",
        )
        .join(" ")
    : apiAuthors;
  const jaccardScore = jaccard(inputStr, apiStr);

  // 加权组合：作者匹配权重高，Jaccard 作为补充
  return authorScore * 0.85 + jaccardScore * 0.15;
}

// 提前终止阈值：找到高分匹配就停止
const EARLY_STOP_THRESHOLD = 0.9;

function pickBest(items, scoreFn) {
  let best = null,
    bestScore = -1,
    bestDetails = null;
  for (const it of items) {
    const result = scoreFn(it);
    const sc = typeof result === "object" ? result.total : result;
    const details = typeof result === "object" ? result.details : null;
    if (sc > bestScore) {
      best = it;
      bestScore = sc;
      bestDetails = details;
    }
    // 提前终止：找到高分匹配就停止
    if (bestScore >= EARLY_STOP_THRESHOLD) {
      break;
    }
  }
  return { best, bestScore, bestDetails };
}

function esc(s) {
  return (s ?? "").toString().replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[m],
  );
}

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

// 复制到剪贴板
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // 回退方案
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      document.body.removeChild(textarea);
      return true;
    } catch (e2) {
      document.body.removeChild(textarea);
      return false;
    }
  }
}

// 下载文件
function downloadFile(content, filename) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** ---------- 解析引用 ---------- */
/** ---------- BibTeX 格式解析 ---------- */
function parseBibTeXFormat(raw) {
  try {
    const s = raw.trim();

    // 提取字段的辅助函数
    const extractField = (fieldName) => {
      const pattern = new RegExp(`${fieldName}\\s*=\\s*[{"]([^}"]*)`, "i");
      const match = s.match(pattern);
      return match ? match[1].trim() : null;
    };

    // 提取作者
    const authorStr = extractField("author");
    let authors = [];
    if (authorStr) {
      // BibTeX 作者格式：Author1 and Author2 and Author3
      authors = authorStr
        .split(/\s+and\s+/i)
        .map((a) => a.trim())
        .filter((a) => a);
    }

    // 提取标题
    const title = extractField("title");

    // 提取期刊/会议名称
    let journal = extractField("journal") || extractField("booktitle");

    // 提取年份
    const yearStr = extractField("year");
    const year = yearStr ? parseInt(yearStr, 10) : null;

    // 提取卷号
    const volume = extractField("volume");

    // 提取期号
    const issue = extractField("number") || extractField("issue");

    // 提取页码
    const pagesStr = extractField("pages");
    let firstPage = null,
      lastPage = null;
    if (pagesStr) {
      const pageMatch = pagesStr.match(/(\d+)\s*[-–—]\s*(\d+)/);
      if (pageMatch) {
        firstPage = pageMatch[1];
        lastPage = pageMatch[2];
      } else {
        firstPage = pagesStr.replace(/\D/g, "");
      }
    }

    // 提取 DOI
    const doi = extractField("doi");

    // 提取出版社
    const publisher = extractField("publisher");

    return {
      raw,
      title,
      authors,
      journal,
      year,
      volume,
      issue,
      firstPage,
      lastPage,
      doi,
      publisher,
      format: "BibTeX",
    };
  } catch (e) {
    console.error("BibTeX 解析失败:", e);
    // 解析失败，返回基本结构
    return {
      raw,
      title: null,
      authors: [],
      journal: null,
      year: null,
      volume: null,
      issue: null,
      firstPage: null,
      lastPage: null,
      doi: null,
      publisher: null,
      format: "BibTeX",
    };
  }
}

function parseCitation(raw) {
  // 预处理：标准化输入
  let s = raw.trim();

  // 检测 BibTeX 格式（以 @ 开头）
  if (s.startsWith("@")) {
    return parseBibTeXFormat(s);
  }

  // 移除开头的序号如 [1], 1., 1)
  s = s.replace(/^\s*\[?\d+[\].):\s]+/, "");
  // 标准化各种空白字符
  s = s
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // 标准化各种引号（添加更多引号类型）
  s = s.replace(/[""„‟«»＂〝〞「」『』]/g, '"').replace(/[''‚‛＇`´]/g, "'");
  // 标准化各种破折号/连字符
  s = s.replace(/[–—−‐‑‒―]/g, "-");

  // 1. 提取年份（支持多种格式：(2019), 2019, [2019]）
  let year = null;
  const yearPatterns = [
    /\((\d{4})\)/, // (2019)
    /\[(\d{4})\]/, // [2019]
    /,\s*(\d{4})\s*[,.:;]/, // , 2019,
    /,\s*(\d{4})\s*$/, // 结尾的年份
    /,\s*[A-Za-z]{3,9}\s+(\d{4})\.?\s*$/, // , May 2022. (IEEE 格式)
    /\b((19|20)\d{2})\b/, // 任意位置的4位年份
  ];
  for (const pat of yearPatterns) {
    const m = s.match(pat);
    if (m) {
      const y = parseInt(m[1] || m[0], 10);
      if (y >= 1900 && y <= 2100) {
        year = y;
        break;
      }
    }
  }

  // 2. 提取 DOI（更宽松的匹配）
  const doiMatch = s.match(/\b(10\.\d{4,9}\/[^\s,;"\]>]+)/i);
  const doi = doiMatch ? doiMatch[1].replace(/[.,;>\]]+$/, "") : null;

  // 3. 检测引用格式类型
  // GB/T 7714 检测：仅使用文献类型标记 [J]/[M]/[C] 等
  // 会议论文 // 分隔：先剥除 URL 再检测，避免 https://... 中的 // 误判
  // 剥除 URL（保留 // + 中文的 GB/T 会议分隔符）
  const sNoUrl = s
    .replace(/https?:\/\/[^\s,;，。]+/g, "")
    .replace(/\/\/(?=[a-zA-Z0-9][-a-zA-Z0-9.]*\.[a-zA-Z]{2,})/g, "")
    .replace(/\bwww\.[^\s,;]+/g, "");
  const hasChineseMarker =
    /\[(J|M|C|D|N|R|S|P|DB|CP|EB|OL|Z|A|G|K)\]/i.test(s) ||
    (/[\u4e00-\u9fa5]/.test(s) && /\/\//.test(sNoUrl)); // 剥除 URL 后检测 // 分隔符
  const hasQuotedTitle = /"[^"]{5,}"|「[^」]{5,}」|《[^》]{5,}》/.test(s);
  const hasIEEEStyle =
    /\bvol\.\s*\d+/i.test(s) ||
    /\bno\.\s*\d+/i.test(s) ||
    /\bpp\.\s*\d+/i.test(s);
  // MLA 格式：Lastname, Firstname. "Title." Journal, vol. X, no. X, Year, pp. X-X.
  const hasMLAStyle =
    hasQuotedTitle && /,\s*vol\.\s*\d+/i.test(s) && /,\s*\d{4}\s*,/i.test(s);
  // Chicago 格式：Firstname Lastname, "Title," Journal Vol, no. X (Year): Pages.
  const hasChicagoStyle =
    hasQuotedTitle && /,\s*no\.\s*\d+\s*\(\d{4}\)\s*:/i.test(s);
  // APA 格式检测：支持西方名字和中文名字
  // 西方：Author, A. A. (Year). 或 中文：作者名. (Year).
  const hasAPAStyle =
    /^[A-Z][^()]+,\s*[A-Z]\.\s*[A-Z]?\.?\s*(?:\(|\[)?\d{4}(?:\)|\])?\./.test(
      s,
    ) || /^[\u4e00-\u9fa5]{2,4}\.\s*\(\d{4}\)\./.test(s); // 中文作者名. (年份).
  const hasVancouverStyle =
    /;\s*\d{4}\s*[;:]/i.test(s) ||
    /\.\s*\d{4}\s*;\s*\d+/.test(s) ||
    /\.\s*\d{4}\s+[A-Za-z]{3,9}\s*;\s*\d+/.test(s); // 支持 2017 Jun;3(2) 格式
  // Harvard 格式：Author (Year) Title. Journal, Vol(Issue), pp. Pages.
  // 或: Author (Year) 'Title', Journal, Vol(Issue), pp. Pages.
  // 注意：Harvard 年份后没有句号，APA 年份后有句号
  const hasHarvardStyle =
    /^[A-Z][^()]+\s*\(\d{4}\)\s*[^.]/.test(s) && // 年份后不是句号
    (/,\s*pp?\.\s*\d+/i.test(s) || /,\s*\d+\s*\(\d+\)\s*,/.test(s));
  // OSA/Optica 格式：Author, "Title," J. Abbr. Vol, Pages (Year).
  // 特征：引号标题 + 期刊缩写（带点，如 Opt. Express, Appl. Opt., IEEE Photon. Technol. Lett.）
  // 必须在 Nature 之前检测，因为 Nature 的正则也能匹配 OSA 格式的期刊部分
  // 检测结束引号后面是否紧跟期刊缩写模式
  // 支持：'," Appl. Opt. 52,' 或 '," IEEE Photon. Technol. Lett. 28,'
  const osaJournalPattern = /[",]\s+[^",]+?\s+\d+(?:\(\d+\))?\s*,/;
  const osaEndPattern =
    /\d+(?:\(\d+\))?,\s*\d+(?:\s*[-–—]\s*\d+)?\s*\(\d{4}\)\s*\.?\s*$/;
  const hasOSAStyle =
    hasQuotedTitle && osaJournalPattern.test(s) && osaEndPattern.test(s);
  // Nature/Science 格式：Journal Volume, Pages (Year)
  const hasNatureScienceStyle =
    /[A-Z][A-Za-z.\s&]+\s+\d+,\s*\d+[-–—]?\d*\s*\(\d{4}\)/.test(s);
  // arXiv 格式检测：包含 arXiv 或 arxiv.org
  const hasArxivStyle =
    /arXiv/i.test(s) || /arxiv\.org/i.test(s) || /\d{4}\.\d{4,5}/.test(s);

  let title = null;
  let journal = null;
  let authors = [];
  let volume = null,
    issue = null;
  let firstPage = null,
    lastPage = null;
  let publisher = null;
  let format = "通用"; // 默认格式

  // =========== 格式检测与解析 ===========

  if (hasChineseMarker) {
    // ===== 中文 GB/T 7714 格式解析 =====
    // 格式：作者. 标题[J]. 期刊名, 年份, 卷(期): 页码.
    format = "GB/T 7714";
    const result = parseChineseGBFormat(s);
    title = result.title;
    journal = result.journal;
    authors = result.authors;
    volume = result.volume;
    issue = result.issue;
    firstPage = result.firstPage;
    lastPage = result.lastPage;
    publisher = result.publisher;
  } else if (hasArxivStyle) {
    // ===== arXiv 格式解析 =====
    // 优先处理 arXiv 引用，避免被其他格式误解析
    format = "arXiv";
    const result = parseArxivFormat(s);
    title = result.title;
    journal = result.journal;
    authors = result.authors;
    // arXiv 预印本不提取卷期页码
  } else if (hasHarvardStyle) {
    // ===== Harvard 格式解析 =====
    // 格式：Smith, J.A. (2020) Title. Journal, Vol(Issue), pp. Pages.
    // 或: Author (Year) 'Title', Journal, Vol(Issue), pp. Pages.
    format = "Harvard";
    const result = parseHarvardFormat(s);
    title = result.title;
    journal = result.journal;
    authors = result.authors;
    volume = result.volume;
    issue = result.issue;
    firstPage = result.firstPage;
    lastPage = result.lastPage;
  } else if (hasMLAStyle) {
    // ===== MLA 格式解析 =====
    // 格式：Lastname, Firstname. "Title." Journal, vol. X, no. X, Year, pp. X-X.
    format = "MLA";
    const result = parseMLAFormat(s);
    title = result.title;
    journal = result.journal;
    authors = result.authors;
    volume = result.volume;
    issue = result.issue;
    firstPage = result.firstPage;
    lastPage = result.lastPage;
  } else if (hasChicagoStyle) {
    // ===== Chicago 格式解析 =====
    // 格式：Firstname Lastname, "Title," Journal Vol, no. X (Year): Pages.
    format = "Chicago";
    const result = parseChicagoFormat(s);
    title = result.title;
    journal = result.journal;
    authors = result.authors;
    volume = result.volume;
    issue = result.issue;
    firstPage = result.firstPage;
    lastPage = result.lastPage;
  } else if (hasIEEEStyle) {
    // ===== IEEE 格式解析 =====
    // 格式：A. Author, "Title," Journal, vol. X, no. X, pp. X-X, Year.
    format = "IEEE";
    const result = parseIEEEFormat(s);
    title = result.title;
    journal = result.journal;
    authors = result.authors;
    volume = result.volume;
    issue = result.issue;
    firstPage = result.firstPage;
    lastPage = result.lastPage;
  } else if (hasAPAStyle) {
    // ===== APA 格式解析 =====
    // 格式：Author, A. A. (Year). Title. Journal, Volume(Issue), Pages.
    format = "APA";
    const result = parseAPAFormat(s);
    title = result.title;
    journal = result.journal;
    authors = result.authors;
    volume = result.volume;
    issue = result.issue;
    firstPage = result.firstPage;
    lastPage = result.lastPage;
  } else if (hasVancouverStyle) {
    // ===== Vancouver 格式解析 =====
    // 格式：Author. Title. Journal. Year;Volume(Issue):Pages.
    format = "Vancouver";
    const result = parseVancouverFormat(s);
    title = result.title;
    journal = result.journal;
    authors = result.authors;
    volume = result.volume;
    issue = result.issue;
    firstPage = result.firstPage;
    lastPage = result.lastPage;
  } else if (hasOSAStyle) {
    // ===== OSA/Optica 格式解析 =====
    // 格式：J. A. Smith, "Title," Appl. Opt. 52, 1234-1245 (2013).
    // 必须在 Nature/Science 之前，因为两者都匹配 "Journal Vol, Pages (Year)" 模式
    format = "OSA/Optica";
    const result = parseOSAFormat(s);
    title = result.title;
    journal = result.journal;
    authors = result.authors;
    volume = result.volume;
    issue = result.issue;
    firstPage = result.firstPage;
    lastPage = result.lastPage;
  } else if (hasNatureScienceStyle) {
    // ===== Nature/Science 格式解析 =====
    // 格式：Author. Title. Journal Volume, Pages (Year).
    // 先尝试 Nature 格式
    format = "Nature/Science";
    const result = parseNatureFormat(s);
    if (result.title || result.journal) {
      title = result.title;
      journal = result.journal;
      authors = result.authors;
      volume = result.volume;
      issue = result.issue;
      firstPage = result.firstPage;
      lastPage = result.lastPage;
    } else {
      // 尝试 Science 格式
      const sciResult = parseScienceFormat(s);
      title = sciResult.title;
      journal = sciResult.journal;
      authors = sciResult.authors;
      volume = sciResult.volume;
      issue = sciResult.issue;
      firstPage = sciResult.firstPage;
      lastPage = sciResult.lastPage;
    }
  } else {
    // ===== 通用智能解析 =====
    format = "通用";
    const result = parseGenericFormat(s);
    title = result.title;
    journal = result.journal;
    authors = result.authors;
    volume = result.volume;
    issue = result.issue;
    firstPage = result.firstPage;
    lastPage = result.lastPage;
  }

  // =========== 后处理和补充提取 ===========

  // 如果还没有提取到卷期页码，使用通用正则（arXiv 格式跳过）
  if (format !== "arXiv" && (!volume || !firstPage)) {
    const extracted = extractVolumeIssuePage(s);
    if (!volume && extracted.volume) volume = extracted.volume;
    if (!issue && extracted.issue) issue = extracted.issue;
    if (!firstPage && extracted.firstPage) firstPage = extracted.firstPage;
    if (!lastPage && extracted.lastPage) lastPage = extracted.lastPage;
  }

  // 清理和标准化
  if (title) {
    title = cleanTitle(title);
  }
  if (journal) {
    journal = cleanJournal(journal);
  }
  if (authors.length > 0) {
    authors = cleanAuthors(authors);
  }

  // 如果标题为空或太短，尝试从原文提取最长的有意义片段
  if (!title || title.length < 10) {
    title = extractTitleFallback(s, authors, journal) || title;
  }

  return {
    raw: s,
    year,
    doi,
    title,
    journal,
    volume,
    issue,
    firstPage,
    lastPage,
    authors,
    publisher,
    format,
  };
}

// ===== 中文 GB/T 7714 格式解析 =====
function parseChineseGBFormat(s) {
  let title = null,
    journal = null,
    authors = [],
    volume = null,
    issue = null;
  let firstPage = null,
    lastPage = null,
    publisher = null,
    year = null;

  // 检测是否为会议论文格式（使用 // 分隔，剥除所有类型 URL 后判断）
  const sClean = s
    .replace(/https?:\/\/[^\s,;，。]+/g, "")
    .replace(/\/\/(?=[a-zA-Z0-9][-a-zA-Z0-9.]*\.[a-zA-Z]{2,})[^\s,;，。]*/g, "")
    .replace(/\bwww\.[^\s,;]+/g, "");
  const hasDoubleSlash = sClean.includes("//");

  if (hasDoubleSlash) {
    // 会议论文格式：作者. 论文标题//会议论文集名称. 年份: 页码.
    // 使用剥除 URL 后的字符串分割，避免 URL 中的 // 干扰
    const parts = sClean.split("//");
    if (parts.length >= 2) {
      const beforeSlash = parts[0].trim();
      const afterSlash = parts[1].trim();

      // 提取作者和标题（在 // 之前）
      const firstDotIdx = beforeSlash.indexOf(". ");
      if (firstDotIdx !== -1) {
        authors = parseChineseAuthors(beforeSlash.slice(0, firstDotIdx));
        title = beforeSlash.slice(firstDotIdx + 2).trim();
      } else {
        // 没有句号，尝试按逗号分割
        const commaParts = beforeSlash.split(/[,，]/);
        if (commaParts.length > 1) {
          authors = parseChineseAuthors(commaParts[0]);
          title = commaParts.slice(1).join(",").trim();
        }
      }

      // 提取会议论文集名称（在 // 之后，第一个句号之前）
      const afterDotIdx = afterSlash.indexOf(". ");
      if (afterDotIdx !== -1) {
        journal = afterSlash.slice(0, afterDotIdx).trim();
      } else {
        // 没有句号，尝试按逗号或冒号分割
        const match = afterSlash.match(/^([^,:：]+)/);
        if (match) journal = match[1].trim();
      }

      // 提取年份（在 // 之后）
      let year = null;
      const yearMatch = afterSlash.match(/[,，.。]\s*(\d{4})\s*[:：]/);
      if (yearMatch) {
        year = parseInt(yearMatch[1], 10);
      }

      // 页码提取
      const pageMatch = afterSlash.match(/[:：]\s*(\d+)\s*[-–—]\s*(\d+)/);
      if (pageMatch) {
        firstPage = pageMatch[1];
        lastPage = pageMatch[2];
      } else {
        const singlePage = afterSlash.match(/[:：]\s*(\d+)\s*[.。]?\s*$/);
        if (singlePage) firstPage = singlePage[1];
      }
    }

    return {
      title,
      journal,
      authors,
      volume,
      issue,
      firstPage,
      lastPage,
      publisher,
      year,
    };
  }

  // 匹配文献类型标记
  const typeMatch = s.match(/\[([JMCDNRSPZA]|DB|CP|EB|OL)\]/i);
  const typeIdx = typeMatch ? s.indexOf(typeMatch[0]) : -1;

  if (typeIdx !== -1) {
    const beforeType = s.slice(0, typeIdx);
    const afterType = s.slice(typeIdx + typeMatch[0].length);

    // 标题：第一个句号后到类型标记前
    const firstDotIdx = beforeType.indexOf(". ");
    if (firstDotIdx !== -1) {
      title = beforeType.slice(firstDotIdx + 2).trim();
    } else {
      // 尝试用中文句号
      const cnDotIdx = beforeType.indexOf("。");
      if (cnDotIdx !== -1) {
        title = beforeType.slice(cnDotIdx + 1).trim();
      } else {
        // 没有明确的句号分隔，尝试按逗号分割
        const parts = beforeType.split(/[,，]/);
        if (parts.length > 1) {
          authors = [parts[0].trim()];
          title = parts.slice(1).join(",").trim();
        }
      }
    }

    // 作者：第一个句号前
    const authorPart =
      firstDotIdx !== -1
        ? beforeType.slice(0, firstDotIdx)
        : beforeType.split(/[,，]/)[0];
    if (authorPart) {
      authors = parseChineseAuthors(authorPart);
    }

    // 期刊/出版信息
    // 期刊格式：. 期刊名, 年份, 卷(期): 页码
    // 书籍格式：. 出版地: 出版社, 年份: 页码
    const journalMatch = afterType.match(/\.\s*([^,，.。]+?)(?:[,，]|$)/);
    if (journalMatch) {
      const jName = journalMatch[1].trim();
      // 判断是期刊还是出版社
      if (/出版|Press|Publisher/i.test(jName)) {
        publisher = jName;
      } else {
        journal = jName;
      }
    }
  } else {
    // 没有类型标记，尝试通用中文格式解析
    // 按句号分割
    const parts = s.split(/[.。]/);
    if (parts.length >= 2) {
      authors = parseChineseAuthors(parts[0]);
      title = parts[1]?.trim();
      if (parts.length >= 3) {
        journal = parts[2]?.split(/[,，]/)[0]?.trim();
      }
    }
  }

  // 卷期：支持多种格式
  // 格式1: 年份, 卷(期)
  const vi1 = s.match(/[,，]\s*\d{4}\s*[,，]\s*(\d+)\s*\(\s*(\d+)\s*\)/);
  // 格式2: 年份, 卷
  const vi2 = s.match(/[,，]\s*\d{4}\s*[,，]\s*(\d+)\s*(?:[:：]|$)/);
  // 格式3: 卷(期)
  const vi3 = s.match(/[,，]\s*(\d+)\s*\(\s*(\d+)\s*\)\s*[:：]/);

  if (vi1) {
    volume = vi1[1];
    issue = vi1[2];
  } else if (vi3) {
    volume = vi3[1];
    issue = vi3[2];
  } else if (vi2) {
    volume = vi2[1];
  }

  // 页码
  const pageMatch = s.match(/[:：]\s*(\d+)\s*[-–—]\s*(\d+)/);
  if (pageMatch) {
    firstPage = pageMatch[1];
    lastPage = pageMatch[2];
  } else {
    // 单页
    const singlePage = s.match(/[:：]\s*(\d+)\s*[.。]?\s*$/);
    if (singlePage) firstPage = singlePage[1];
  }

  return {
    title,
    journal,
    authors,
    volume,
    issue,
    firstPage,
    lastPage,
    publisher,
  };
}

// ===== arXiv 格式解析 =====
// 支持多种 arXiv 引用格式：
// - MLA: Author, et al. "Title." arXiv, Year, arxiv.org/abs/XXXX.XXXXX.
// - APA: Author (Year). Title. arXiv preprint arXiv:XXXX.XXXXX.
// - 通用: Author. Title. arXiv:XXXX.XXXXX, Year.
function parseArxivFormat(s) {
  let title = null,
    journal = "arXiv",
    authors = [];

  // 移除 arXiv URL 和 ID 部分，避免干扰标题提取
  const cleanedForTitle = s
    .replace(/arxiv\.org\/abs\/\d{4}\.\d{4,5}/gi, "")
    .replace(/arXiv:\s*\d{4}\.\d{4,5}/gi, "")
    .replace(/arXiv\s+preprint\s+arXiv:\s*\d{4}\.\d{4,5}/gi, "")
    .replace(/\d{4}\.\d{4,5}/g, "");

  // 尝试提取引号内的标题
  const quotedTitle = s.match(/"([^"]+)"/);
  if (quotedTitle) {
    title = quotedTitle[1].trim();

    // 作者在引号前
    const quoteStart = s.indexOf(quotedTitle[0]);
    let beforeQuote = s.slice(0, quoteStart).trim();
    beforeQuote = beforeQuote.replace(/[,，.。]\s*$/, "");
    if (beforeQuote) {
      authors = parseWesternAuthors(beforeQuote);
    }
  } else {
    // 没有引号，尝试按句号分割
    // 格式可能是：Author. Title. arXiv:XXXX.XXXXX.
    const parts = cleanedForTitle.split(/\.\s+/).filter((p) => p.trim());

    if (parts.length >= 2) {
      // 第一部分是作者
      authors = parseWesternAuthors(parts[0]);

      // 第二部分是标题（可能包含多个句号分隔的部分）
      // 找到不是 "arXiv" 的部分作为标题
      for (let i = 1; i < parts.length; i++) {
        const part = parts[i].trim();
        if (part && !/^arXiv/i.test(part) && part.length > 5) {
          title = part;
          break;
        }
      }
    }
  }

  // 清理标题
  if (title) {
    title = title
      .replace(/[,，.。]+$/, "")
      .replace(/\s+arXiv.*$/i, "")
      .trim();
  }

  return { title, journal, authors };
}

// ===== OSA/Optica 格式解析 =====
// 格式：J. A. Smith, B. C. Johnson, and D. E. Williams, "Title," Appl. Opt. 52, 1234-1245 (2013).
// 或：G. Lazarev, A. Hermerschmidt, S. Krüger, and S. Osten, "LCOS spatial light modulators," Opt. Express 20, 3344-3355 (2012).
// 或：T. Wang, et al., "Title," IEEE Photon. Technol. Lett. 28, 3-6 (2016).
function parseOSAFormat(s) {
  let title = null;
  let journal = null;
  let authors = [];
  let volume = null;
  let issue = null;
  let firstPage = null;
  let lastPage = null;
  let year = null;

  // ---------- 1. 提取标题 ----------
  const titleMatch = s.match(/"([^"]+)"/);
  if (!titleMatch) {
    return {
      title,
      journal,
      authors,
      volume,
      issue,
      firstPage,
      lastPage,
      year,
    };
  }

  title = titleMatch[1].trim();

  const quoteStart = s.indexOf(titleMatch[0]);
  const quoteEnd = quoteStart + titleMatch[0].length;

  // ---------- 2. 作者（标题前） ----------
  let beforeQuote = s.slice(0, quoteStart).trim();
  beforeQuote = beforeQuote.replace(/[,，]\s*$/, "");
  if (beforeQuote) {
    authors = parseWesternAuthors(beforeQuote);
  }

  // ---------- 3. 标题后的主体 ----------
  let afterQuote = s.slice(quoteEnd).trim();
  afterQuote = afterQuote.replace(/^[,，]\s*/, "");

  // ---------- 4. OSA 核心结构解析 ----------
  // journal + volume(issue), pages (year)
  const osaCorePattern =
    /^(.+?)\s+(\d+)(?:\((\d+)\))?,\s*(\d+)(?:\s*[-–—]\s*(\d+))?\s*\((\d{4})\)\s*\.?\s*$/;

  const m = afterQuote.match(osaCorePattern);
  if (!m) {
    // 理论上不应该进来（已通过 hasOSAStyle）
    return {
      title,
      journal,
      authors,
      volume,
      issue,
      firstPage,
      lastPage,
      year,
    };
  }

  // ---------- 5. 字段填充 ----------
  journal = m[1].trim();
  volume = m[2];
  issue = m[3] || null;
  firstPage = m[4];
  lastPage = m[5] || null;
  year = m[6];

  return {
    title,
    journal,
    authors,
    volume,
    issue,
    firstPage,
    lastPage,
    year,
  };
}

// 解析中文作者
function parseChineseAuthors(authorStr) {
  if (!authorStr) return [];

  // 移除 "等" "et al"
  authorStr = authorStr
    .replace(/[,，]?\s*等\s*$/i, "")
    .replace(/et\s+al\.?/gi, "");

  // 按逗号和"和"分割
  const parts = authorStr.split(/[,，]|\s+和\s+|\s+and\s+/i);

  return parts.map((p) => p.trim()).filter((p) => p && p.length >= 2);
}

function parseIEEEFormat(s) {
  let title = null,
    journal = null,
    authors = [],
    volume = null,
    issue = null;
  let firstPage = null,
    lastPage = null;

  const titleMatch = s.match(/"([^"]+)"/);
  if (titleMatch) {
    title = titleMatch[1].replace(/[,，.]$/, "").trim();

    const beforeQuote = s.slice(0, s.indexOf('"')).trim();
    authors = parseWesternAuthors(beforeQuote.replace(/[,，]\s*$/, ""));

    // 期刊和卷期在引号后
    let afterQuote = s.slice(s.indexOf('"', s.indexOf('"') + 1) + 1).trim();
    afterQuote = afterQuote.replace(/^[,，]\s*/, "");

    // 期刊名（vol. 或 no. 或年份前的部分）
    const journalMatch = afterQuote.match(
      /^([^,]+?)(?:\s*[,，]\s*(?:vol\.|no\.|\d{4}))/i,
    );
    if (journalMatch) {
      journal = journalMatch[1].trim();
    }
  }

  // vol. X
  const volMatch = s.match(/vol\.\s*(\d+)/i);
  if (volMatch) volume = volMatch[1];

  // no. X
  const noMatch = s.match(/no\.\s*(\d+)/i);
  if (noMatch) issue = noMatch[1];

  // pp. X-X 或 pp. X
  const ppMatch = s.match(/pp?\.\s*(\d+)\s*[-–—]?\s*(\d+)?/i);
  if (ppMatch) {
    firstPage = ppMatch[1];
    lastPage = ppMatch[2] || null;
  }

  return { title, journal, authors, volume, issue, firstPage, lastPage };
}

// ===== 带引号标题格式（MLA, Chicago 等）=====
function parseQuotedTitleFormat(s) {
  let title = null,
    journal = null,
    authors = [],
    volume = null,
    issue = null;
  let firstPage = null,
    lastPage = null;

  // 查找引号中的标题
  // 支持多种引号：""  「」 《》
  let titleMatch = s.match(/"([^"]{5,})"/);
  if (!titleMatch) titleMatch = s.match(/「([^」]{5,})」/);
  if (!titleMatch) titleMatch = s.match(/《([^》]{5,})》/);

  if (titleMatch) {
    title = titleMatch[1].replace(/[,，.。]$/, "").trim();
    const quoteStart = s.indexOf(titleMatch[0]);
    const quoteEnd = quoteStart + titleMatch[0].length;

    // 作者（引号前）
    let beforeQuote = s.slice(0, quoteStart).trim();
    beforeQuote = beforeQuote.replace(/[,，.。]\s*$/, "");
    if (beforeQuote) {
      authors = parseWesternAuthors(beforeQuote);
    }

    // 引号后的内容
    let afterQuote = s.slice(quoteEnd).trim();
    afterQuote = afterQuote.replace(/^[,，.。]\s*/, "");

    // 尝试多种期刊匹配模式
    // 模式1: Journal Vol, Pages (Year)
    const p1 = afterQuote.match(
      /^([A-Za-z][A-Za-z.\s&]+?)\s+(\d+)\s*[,，]\s*(\d+)\s*[-–—]\s*(\d+)\s*\(\d{4}\)/,
    );
    // 模式2: Journal, Vol(Issue), Pages
    const p2 = afterQuote.match(
      /^([A-Za-z][A-Za-z.\s&,]+?)\s*[,，]\s*(\d+)\s*\(\s*(\d+)\s*\)\s*[,，:：]\s*(\d+)\s*[-–—]\s*(\d+)/,
    );
    // 模式3: Journal Vol.Issue (Year): Pages
    const p3 = afterQuote.match(
      /^([A-Za-z][A-Za-z.\s&]+?)\s+(\d+)\.(\d+)\s*\(\d{4}\)\s*[:：]\s*(\d+)\s*[-–—]\s*(\d+)/,
    );
    // 模式4: Journal (Year) Vol: Pages
    const p4 = afterQuote.match(
      /^([A-Za-z][A-Za-z.\s&]+?)\s*\(\d{4}\)\s*(\d+)\s*[:：]\s*(\d+)\s*[-–—]?\s*(\d+)?/,
    );

    if (p1) {
      journal = p1[1].trim();
      volume = p1[2];
      firstPage = p1[3];
      lastPage = p1[4];
    } else if (p2) {
      journal = p2[1].trim();
      volume = p2[2];
      issue = p2[3];
      firstPage = p2[4];
      lastPage = p2[5];
    } else if (p3) {
      journal = p3[1].trim();
      volume = p3[2];
      issue = p3[3];
      firstPage = p3[4];
      lastPage = p3[5];
    } else if (p4) {
      journal = p4[1].trim();
      volume = p4[2];
      firstPage = p4[3];
      lastPage = p4[4];
    } else {
      // 尝试提取期刊名（到数字或逗号为止）
      const jMatch = afterQuote.match(
        /^([A-Za-z][A-Za-z.\s&]+?)(?:\s+\d|[,，]|\()/,
      );
      if (jMatch) {
        journal = jMatch[1].trim();
      }
    }
  }

  return { title, journal, authors, volume, issue, firstPage, lastPage };
}

// ===== MLA 格式解析 =====
// 格式：Lastname, Firstname. "Title." Journal, vol. X, no. X, Year, pp. X-X.
function parseMLAFormat(s) {
  let title = null,
    journal = null,
    authors = [],
    volume = null,
    issue = null;
  let firstPage = null,
    lastPage = null;

  // 提取引号内的标题
  const titleMatch = s.match(/"([^"]+)"/);
  if (titleMatch) {
    title = titleMatch[1].trim();

    const quoteStart = s.indexOf(titleMatch[0]);
    const quoteEnd = quoteStart + titleMatch[0].length;

    // 作者（引号前）
    let beforeQuote = s.slice(0, quoteStart).trim();
    beforeQuote = beforeQuote.replace(/[,，.。]\s*$/, "");
    if (beforeQuote) {
      authors = parseWesternAuthors(beforeQuote);
    }

    // 引号后的内容
    let afterQuote = s.slice(quoteEnd).trim();
    afterQuote = afterQuote.replace(/^[,，.。]\s*/, "");

    // MLA 格式：Journal, vol. X, no. X, Year, pp. X-X.
    const mlaMatch = afterQuote.match(
      /^([^,]+),\s*vol\.\s*(\d+)(?:,\s*no\.\s*(\d+))?(?:,\s*\d{4})?(?:,\s*pp?\.\s*(\d+)\s*[-–—]\s*(\d+))?/i,
    );
    if (mlaMatch) {
      journal = mlaMatch[1].trim();
      volume = mlaMatch[2];
      issue = mlaMatch[3] || null;
      firstPage = mlaMatch[4] || null;
      lastPage = mlaMatch[5] || null;
    } else {
      // 尝试提取期刊名
      const jMatch = afterQuote.match(/^([^,]+)/);
      if (jMatch) {
        journal = jMatch[1].trim();
      }
    }
  }

  return { title, journal, authors, volume, issue, firstPage, lastPage };
}

// ===== Chicago 格式解析 =====
// 格式：Firstname Lastname, "Title," Journal Vol, no. X (Year): Pages.
function parseChicagoFormat(s) {
  let title = null,
    journal = null,
    authors = [],
    volume = null,
    issue = null;
  let firstPage = null,
    lastPage = null;

  // 提取引号内的标题
  const titleMatch = s.match(/"([^"]+)"/);
  if (titleMatch) {
    title = titleMatch[1].trim();

    const quoteStart = s.indexOf(titleMatch[0]);
    const quoteEnd = quoteStart + titleMatch[0].length;

    // 作者（引号前）
    let beforeQuote = s.slice(0, quoteStart).trim();
    beforeQuote = beforeQuote.replace(/[,，]\s*$/, "");
    if (beforeQuote) {
      authors = parseWesternAuthors(beforeQuote);
    }

    // 引号后的内容
    let afterQuote = s.slice(quoteEnd).trim();
    afterQuote = afterQuote.replace(/^[,，]\s*/, "");

    // Chicago 格式：Journal Vol, no. X (Year): Pages.
    const chicagoMatch = afterQuote.match(
      /^([A-Za-z][A-Za-z.\s&]+?)\s+(\d+)(?:,\s*no\.\s*(\d+))?\s*\(\d{4}\)\s*:\s*(\d+)\s*[-–—]?\s*(\d+)?/i,
    );
    if (chicagoMatch) {
      journal = chicagoMatch[1].trim();
      volume = chicagoMatch[2];
      issue = chicagoMatch[3] || null;
      firstPage = chicagoMatch[4] || null;
      lastPage = chicagoMatch[5] || null;
    } else {
      // 尝试提取期刊名
      const jMatch = afterQuote.match(/^([A-Za-z][A-Za-z.\s&]+?)(?:\s+\d|\()/);
      if (jMatch) {
        journal = jMatch[1].trim();
      }
    }
  }

  return { title, journal, authors, volume, issue, firstPage, lastPage };
}

// ===== APA 格式解析 =====
function parseAPAFormat(s) {
  let title = null,
    journal = null,
    authors = [],
    volume = null,
    issue = null;
  let firstPage = null,
    lastPage = null;

  // APA: Author, A. A., & Author, B. B. (Year). Title. Journal, Volume(Issue), Pages. doi
  // 中文 APA: 作者名. (年份). 标题. 期刊名, 卷(期), 页码. doi

  // 先移除末尾的 URL/DOI 链接
  const cleanedS = s.replace(/\s*https?:\/\/[^\s]+\s*$/i, "").trim();

  // 查找年份位置 (Year). 格式
  const yearMatch = cleanedS.match(/\((\d{4})\)\./);
  if (yearMatch) {
    const yearIdx = cleanedS.indexOf(yearMatch[0]);

    // 作者（年份前）
    const authorPart = cleanedS.slice(0, yearIdx).trim();

    // 检测是否是中文作者
    const isChinese = /^[\u4e00-\u9fa5]/.test(authorPart);
    if (isChinese) {
      // 中文作者：可能是 "作者名." 或 "作者1, 作者2."
      const cleanAuthor = authorPart.replace(/\.\s*$/, "").trim();
      authors = cleanAuthor
        .split(/[,，、]\s*/)
        .map((a) => a.trim())
        .filter(Boolean);
    } else {
      authors = parseWesternAuthors(authorPart);
    }

    // 年份后的内容
    const afterYear = cleanedS.slice(yearIdx + yearMatch[0].length).trim();

    // 按句号分割（排除 URL）
    // 注意：中文标题可能包含英文句号，需要更智能的分割
    const parts = afterYear.split(/\.\s+/).filter((p) => !p.startsWith("http"));

    if (parts.length >= 1) {
      // 第一部分是标题
      title = parts[0].trim();
    }

    if (parts.length >= 2) {
      // 第二部分是期刊信息
      const journalPart = parts[1];
      // Journal, Volume(Issue), Pages
      // 支持中文期刊名和页码格式
      const jMatch = journalPart.match(
        /^([^,，]+)[,，]\s*(\d+)(?:\((\d+)\))?[,，]?\s*(\d+)?\s*[-–—]?\s*(\d+)?/,
      );
      if (jMatch) {
        journal = jMatch[1].trim();
        volume = jMatch[2];
        issue = jMatch[3] || null;
        firstPage = jMatch[4] || null;
        lastPage = jMatch[5] || null;
      } else {
        // 只有期刊名
        journal = journalPart.split(/[,，]/)[0].trim();
      }
    } else if (parts.length === 1) {
      // 标题和期刊在同一部分，尝试分割
      // 格式可能是：标题. 期刊名, 卷(期), 页码
      const combinedMatch = parts[0].match(
        /^(.+?)[.。]\s*([^,，.。]+)[,，]\s*(\d+)\s*\(\s*(\d+)\s*\)[,，]?\s*(\d+)?/,
      );
      if (combinedMatch) {
        title = combinedMatch[1].trim();
        journal = combinedMatch[2].trim();
        volume = combinedMatch[3];
        issue = combinedMatch[4];
        firstPage = combinedMatch[5] || null;
      }
    }
  } else {
    // 没有标准的年份格式，尝试通用解析
    return parseGenericFormat(s);
  }

  return { title, journal, authors, volume, issue, firstPage, lastPage };
}

// ===== Vancouver 格式解析 =====
function parseVancouverFormat(s) {
  let title = null,
    journal = null,
    authors = [],
    volume = null,
    issue = null;
  let firstPage = null,
    lastPage = null;

  // Vancouver: Author. Title. Journal. Year;Volume(Issue):Pages.
  // 或: Author. Title. Journal. Year Month;Volume(Issue):Pages.

  // 按句号分割
  const parts = s.split(/\.\s+/);

  if (parts.length >= 2) {
    // 第一部分：作者
    authors = parseWesternAuthors(parts[0]);

    // 第二部分：标题
    if (parts.length >= 2) {
      title = parts[1].trim();
    }

    // 第三部分及之后：期刊和元数据
    if (parts.length >= 3) {
      // 检查 parts[2] 是否包含年份和卷期信息
      const journalPart = parts[2];
      // Journal. Year;Vol(Issue):Pages 或 Journal. Year Month;Vol(Issue):Pages
      const jMatch = journalPart.match(
        /^([^.;]+?)(?:\.\s*|\s+)?(\d{4})(?:\s+[A-Za-z]{3,9})?\s*;\s*(\d+)(?:\((\d+)\))?:?\s*(\d+)?\s*[-–—]?\s*(\d+)?/,
      );
      if (jMatch) {
        journal = jMatch[1].trim();
        volume = jMatch[3];
        issue = jMatch[4] || null;
        firstPage = jMatch[5] || null;
        lastPage = jMatch[6] || null;
      } else {
        // 期刊名可能在 parts[2]，年份/卷期在 parts[3]
        journal = journalPart.split(/\s*[.;]\s*|\s+\d{4}/)[0].trim();

        // 检查 parts[3] 是否有年份和卷期信息
        if (parts.length >= 4) {
          const metaPart = parts[3];
          // Year;Vol(Issue):Pages 或 Year Month;Vol(Issue):Pages
          const metaMatch = metaPart.match(
            /^(\d{4})(?:\s+[A-Za-z]{3,9})?\s*;\s*(\d+)(?:\((\d+)\))?:?\s*(\d+)?\s*[-–—]?\s*(\d+)?/,
          );
          if (metaMatch) {
            volume = metaMatch[2];
            issue = metaMatch[3] || null;
            firstPage = metaMatch[4] || null;
            lastPage = metaMatch[5] || null;
          }
        }
      }
    }
  }

  // 补充提取卷期页码（支持带月份的格式）
  const viMatch = s.match(
    /(\d{4})(?:\s+[A-Za-z]{3,9})?\s*;\s*(\d+)\s*(?:\(\s*(\d+)\s*\))?/,
  );
  if (viMatch && !volume) {
    volume = viMatch[2];
    issue = viMatch[3] || null;
  }

  const ppMatch = s.match(/[:]\s*(\d+)\s*[-–—]\s*(\d+)/);
  if (ppMatch && !firstPage) {
    firstPage = ppMatch[1];
    lastPage = ppMatch[2];
  }

  return { title, journal, authors, volume, issue, firstPage, lastPage };
}

// ===== Harvard 格式解析 =====
// 格式：Smith, J.A. (2020) Deep learning in medical imaging. Nature Medicine, 26(3), pp. 317-325.
function parseHarvardFormat(s) {
  let title = null,
    journal = null,
    authors = [],
    volume = null,
    issue = null;
  let firstPage = null,
    lastPage = null;

  // Harvard: Author, A.A. (Year) Title. Journal, Volume(Issue), pp. Pages.
  // 或: Author, A.A. (Year) 'Title', Journal, Volume(Issue), pp. Pages.

  // 查找年份位置 (Year)
  const yearMatch = s.match(/\((\d{4})\)/);
  if (yearMatch) {
    const yearIdx = s.indexOf(yearMatch[0]);

    // 作者（年份前）
    const authorPart = s.slice(0, yearIdx).trim();
    authors = parseWesternAuthors(authorPart);

    // 年份后的内容
    let afterYear = s.slice(yearIdx + yearMatch[0].length).trim();

    // 查找标题（到第一个句号或引号结束）
    // 支持带引号的标题
    const quotedTitle = afterYear.match(/^['"]([^'"]+)['"]/);
    if (quotedTitle) {
      title = quotedTitle[1].trim();
      afterYear = afterYear.slice(quotedTitle[0].length).trim();
      afterYear = afterYear.replace(/^[,.\s]+/, "");
    } else {
      // 不带引号的标题（到句号为止）
      const titleEnd = afterYear.indexOf(". ");
      if (titleEnd !== -1) {
        title = afterYear.slice(0, titleEnd).trim();
        afterYear = afterYear.slice(titleEnd + 2).trim();
      }
    }

    // 期刊信息：Journal, Volume(Issue), pp. Pages
    const journalMatch = afterYear.match(
      /^([^,]+),\s*(\d+)(?:\((\d+)\))?(?:,\s*pp?\.\s*(\d+)[-–—]?(\d+)?)?/,
    );
    if (journalMatch) {
      journal = journalMatch[1].trim();
      volume = journalMatch[2];
      issue = journalMatch[3] || null;
      firstPage = journalMatch[4] || null;
      lastPage = journalMatch[5] || null;
    } else {
      // 只有期刊名
      const jMatch = afterYear.match(/^([^,.\d]+)/);
      if (jMatch) {
        journal = jMatch[1].trim();
      }
    }
  } else {
    // 没有标准的年份格式，尝试通用解析
    return parseGenericFormat(s);
  }

  return { title, journal, authors, volume, issue, firstPage, lastPage };
}

// ===== Nature 格式解析 =====
// 格式：Smith, J. A. Deep learning in medical imaging. Nature Medicine 26, 317–325 (2020).
// 或：Smith, J. A. et al. Title. Nature 600, 123-128 (2021).
function parseNatureFormat(s) {
  let title = null,
    journal = null,
    authors = [],
    volume = null,
    issue = null;
  let firstPage = null,
    lastPage = null;

  // Nature 格式特征：期刊名后直接跟卷号（无逗号），页码后跟年份
  // 策略：从后往前找 "Journal Volume, Pages (Year)" 模式
  // 期刊名限制为1-4个单词（每个单词首字母大写）
  const naturePattern = s.match(
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+(\d+),\s*(\d+)[-–—](\d+)\s*\((\d{4})\)\s*\.?\s*$/,
  );

  if (naturePattern) {
    journal = naturePattern[1].trim();
    volume = naturePattern[2];
    firstPage = naturePattern[3];
    lastPage = naturePattern[4];

    // 找到期刊名在原字符串中的位置
    const journalIdx = s.lastIndexOf(journal);
    const beforeJournal = s.slice(0, journalIdx).trim();

    // 移除末尾的句号
    const cleanBefore = beforeJournal.replace(/\.\s*$/, "");

    // 按句号分割作者和标题
    const lastDotIdx = cleanBefore.lastIndexOf(". ");
    if (lastDotIdx !== -1) {
      const authorPart = cleanBefore.slice(0, lastDotIdx);
      title = cleanBefore.slice(lastDotIdx + 2).trim();
      authors = parseWesternAuthors(authorPart.replace(/\s+et\s+al\.?/gi, ""));
    } else {
      // 尝试找到作者和标题的分界
      const parts = cleanBefore.split(/\.\s+/);
      if (parts.length >= 2) {
        authors = parseWesternAuthors(parts[0].replace(/\s+et\s+al\.?/gi, ""));
        title = parts.slice(1).join(". ").trim();
      }
    }
  } else {
    // 尝试另一种 Nature 格式：没有页码范围
    const naturePattern2 = s.match(
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+(\d+),\s*(\d+)\s*\((\d{4})\)\s*\.?\s*$/,
    );
    if (naturePattern2) {
      journal = naturePattern2[1].trim();
      volume = naturePattern2[2];
      firstPage = naturePattern2[3];

      const journalIdx = s.lastIndexOf(journal);
      const beforeJournal = s.slice(0, journalIdx).trim();
      const cleanBefore = beforeJournal.replace(/\.\s*$/, "");

      const lastDotIdx = cleanBefore.lastIndexOf(". ");
      if (lastDotIdx !== -1) {
        const authorPart = cleanBefore.slice(0, lastDotIdx);
        title = cleanBefore.slice(lastDotIdx + 2).trim();
        authors = parseWesternAuthors(
          authorPart.replace(/\s+et\s+al\.?/gi, ""),
        );
      }
    } else {
      return parseGenericFormat(s);
    }
  }

  return { title, journal, authors, volume, issue, firstPage, lastPage };
}

// ===== Science 格式解析 =====
// 格式：J. A. Smith, Deep learning in medical imaging. Science 368, 1234-1238 (2020).
// 或：J. A. Smith et al., Title. Science 368, 1234 (2020).
function parseScienceFormat(s) {
  let title = null,
    journal = null,
    authors = [],
    volume = null,
    issue = null;
  let firstPage = null,
    lastPage = null;

  // Science 格式与 Nature 类似，但作者名通常是 "F. Lastname" 格式
  // 匹配模式：Journal Volume, Pages (Year)
  const sciencePattern = s.match(
    /([A-Z][A-Za-z.\s&]+?)\s+(\d+),\s*(\d+)[-–—]?(\d+)?\s*\((\d{4})\)/,
  );

  if (sciencePattern) {
    journal = sciencePattern[1].trim();
    volume = sciencePattern[2];
    firstPage = sciencePattern[3];
    lastPage = sciencePattern[4] || null;

    // 找到期刊名在原字符串中的位置
    const journalIdx = s.indexOf(sciencePattern[0]);
    const beforeJournal = s.slice(0, journalIdx).trim();

    // Science 格式：作者, 标题.
    // 查找最后一个句号（标题结尾）
    const lastDotIdx = beforeJournal.lastIndexOf(".");
    if (lastDotIdx !== -1) {
      const beforeDot = beforeJournal.slice(0, lastDotIdx).trim();

      // 查找作者和标题的分界（通常是逗号后跟大写字母开头的标题）
      // 模式：Authors, Title
      const commaMatch = beforeDot.match(/^(.+?),\s+([A-Z][^,].*)$/);
      if (commaMatch) {
        authors = parseWesternAuthors(
          commaMatch[1].replace(/\s+et\s+al\.?/gi, ""),
        );
        title = commaMatch[2].trim();
      } else {
        // 尝试按句号分割
        const parts = beforeDot.split(/\.\s+/);
        if (parts.length >= 2) {
          authors = parseWesternAuthors(
            parts[0].replace(/\s+et\s+al\.?/gi, ""),
          );
          title = parts.slice(1).join(". ").trim();
        } else {
          title = beforeDot;
        }
      }
    }
  } else {
    return parseGenericFormat(s);
  }

  return { title, journal, authors, volume, issue, firstPage, lastPage };
}

// ===== 通用智能解析 =====
function parseGenericFormat(s) {
  let title = null,
    journal = null,
    authors = [],
    volume = null,
    issue = null;
  let firstPage = null,
    lastPage = null;

  // 0. 先移除末尾的 URL/DOI 链接
  const cleanedS = s.replace(/\s*https?:\/\/[^\s]+\s*$/i, "").trim();

  // 0.1 检测是否是"期刊行"格式（如 APA 引用的第二行）
  // 格式：Journal Name, Volume(Issue), Pages
  const journalLineMatch = cleanedS.match(
    /^([A-Z][A-Za-z\s&]+),\s*(\d+)\s*\((\d+)\)\s*,\s*(\d+)\s*[-–—]\s*(\d+)/,
  );
  if (journalLineMatch) {
    journal = journalLineMatch[1].trim();
    volume = journalLineMatch[2];
    issue = journalLineMatch[3];
    firstPage = journalLineMatch[4];
    lastPage = journalLineMatch[5];
    // 这种情况下没有标题和作者
    return {
      title,
      journal,
      authors,
      volume,
      issue,
      firstPage,
      lastPage,
    };
  }

  // 1. 先提取期刊缩写模式（如 J. Comput. Phys. 225）
  // 匹配：多个"单词+点"组合，后跟卷号
  const journalAbbrMatch = cleanedS.match(
    /([A-Z][a-z]*\.(?:\s*[A-Z][a-z]*\.)+)\s*(\d+)\s*(?:\((\d+)\))?/,
  );
  if (journalAbbrMatch) {
    journal = journalAbbrMatch[1].trim();
    volume = journalAbbrMatch[2];
    issue = journalAbbrMatch[3] || null;
  }

  // 2. 找到期刊在原字符串中的位置，提取期刊之前的部分
  let beforeJournal = cleanedS;
  if (journal) {
    const journalIdx = cleanedS.indexOf(journal);
    if (journalIdx > 0) {
      beforeJournal = cleanedS.slice(0, journalIdx).trim();
      // 移除末尾的句号
      beforeJournal = beforeJournal.replace(/\.\s*$/, "");
    }
  }

  // 3. 在 beforeJournal 中找到作者和标题的分界
  // 策略：找到 "X. " 后面跟着 "大写字母开头的长单词（>=4字母）" 的位置
  // 这通常是标题的开始（作者缩写后跟标题首词）
  const titleStartMatch = beforeJournal.match(/([A-Z])\.\s+([A-Z][a-z]{3,})/);
  if (titleStartMatch) {
    const matchIdx = beforeJournal.indexOf(titleStartMatch[0]);
    // 作者部分：从开头到匹配位置 + 单字母 + 点
    const authorPart = beforeJournal
      .slice(0, matchIdx + titleStartMatch[1].length + 1)
      .trim();
    // 标题部分：从长单词开始
    const titlePart = beforeJournal
      .slice(matchIdx + titleStartMatch[1].length + 2)
      .trim();

    authors = parseWesternAuthors(authorPart);
    title = titlePart;
  } else {
    // 回退：按第一个句号+空格分割
    const firstDotIdx = beforeJournal.indexOf(". ");
    if (firstDotIdx > 0) {
      authors = parseWesternAuthors(beforeJournal.slice(0, firstDotIdx));
      title = beforeJournal.slice(firstDotIdx + 2);
    } else {
      // 没有期刊的情况，使用原来的分割逻辑
      const parts = cleanedS
        .split(/\.\s+/)
        .filter((p) => !p.startsWith("http"));
      if (parts.length >= 2) {
        if (looksLikeAuthors(parts[0])) {
          authors = parseWesternAuthors(parts[0]);
          title = parts[1];
        } else {
          title = parts[0];
        }
        // 尝试从后续部分提取期刊
        if (!journal && parts.length >= 3) {
          const jMatch = parts[2].match(/^([^,\d]+)/);
          if (jMatch && !jMatch[1].startsWith("http")) {
            journal = jMatch[1].trim();
          }
        }
      } else {
        title = beforeJournal;
      }
    }
  }

  return { title, journal, authors, volume, issue, firstPage, lastPage };
}

// 按逗号分割的格式
function parseCommaSeparatedFormat(s) {
  let title = null,
    journal = null,
    authors = [],
    volume = null,
    issue = null;
  let firstPage = null,
    lastPage = null;

  const parts = s.split(/,\s*/);

  // 第一部分通常是作者或标题
  if (parts.length >= 1) {
    if (looksLikeAuthors(parts[0])) {
      authors = parseWesternAuthors(parts[0]);
      if (parts.length >= 2) title = parts[1];
    } else {
      title = parts[0];
    }
  }

  return { title, journal, authors, volume, issue, firstPage, lastPage };
}

// 判断是否像作者
function looksLikeAuthors(s) {
  if (!s) return false;
  // 包含 "and" 或多个逗号分隔的名字
  if (/\s+and\s+/i.test(s)) return true;
  // 包含缩写名 A. B.
  if (/[A-Z]\.\s*[A-Z]?\.?/.test(s)) return true;
  // 姓, 名 格式
  if (/^[A-Z][a-z]+,\s*[A-Z]/.test(s)) return true;
  // 中文作者
  if (/^[\u4e00-\u9fa5]{2,4}(?:[,，][\u4e00-\u9fa5]{2,4})*/.test(s))
    return true;
  return false;
}

// 判断是否像期刊
function looksLikeJournal(s) {
  if (!s) return false;
  // 包含典型期刊词汇
  if (
    /\b(Journal|Review|Letters|Proceedings|Trans|Conf|Ann|Sci|Research)\b/i.test(
      s,
    )
  )
    return true;
  // 包含缩写 (带点的单词)
  if (/[A-Z][a-z]*\.\s*[A-Z]/.test(s)) return true;
  // 包含卷期信息
  if (/\d+\s*\(\d+\)/.test(s)) return true;
  return false;
}

// 分析句子类型
function analyzePart(s) {
  if (looksLikeAuthors(s)) return { type: "author", content: s };
  if (looksLikeJournal(s)) return { type: "journal", content: s };
  return { type: "unknown", content: s };
}

// 解析西方作者名
function parseWesternAuthors(s) {
  if (!s) return [];

  // 清理
  s = s
    .replace(/et\s+al\.?/gi, "")
    .replace(/\s*&\s*/g, " and ")
    .replace(/[,，]\s*$/, "")
    .trim();

  // 按 and/逗号 分割
  // 注意：逗号可能在名字内部（Lastname, Firstname），需要特殊处理

  let authors = [];

  // 检测是否是 "Lastname, Firstname" 格式
  if (/^[A-Z][a-z]+,\s*[A-Z]/.test(s)) {
    // 先按 and 分割
    const andParts = s.split(/\s+and\s+/i);
    for (const part of andParts) {
      // 每个部分可能有多个作者用分号分隔
      const semicolonParts = part.split(/;\s*/);
      for (const sp of semicolonParts) {
        // 处理 "Zhang, J., Liu, P., Zhang, F, Song, Q" 这种格式
        // 策略：匹配 "Lastname, Initial(s)." 或 "Lastname, Initial(s)" 模式
        // 使用正则匹配每个作者
        const authorPattern =
          /([A-Z][a-z]+),\s*([A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*)*)/g;
        let match;
        let lastIndex = 0;
        let foundAuthors = [];

        while ((match = authorPattern.exec(sp)) !== null) {
          foundAuthors.push(`${match[1]}, ${match[2]}`);
          lastIndex = authorPattern.lastIndex;
        }

        if (foundAuthors.length > 0) {
          authors.push(...foundAuthors);
        } else if (sp.trim()) {
          authors.push(sp.trim());
        }
      }
    }
  } else {
    // 普通格式：按 and 和逗号分割
    authors = s
      .split(/,\s*(?:and\s+)?|\s+and\s+/i)
      .map((a) => a.trim())
      .filter(Boolean);
  }

  return authors.filter((a) => a.length >= 2);
}

// 提取卷期页码（通用）
function extractVolumeIssuePage(s) {
  let volume = null,
    issue = null,
    firstPage = null,
    lastPage = null;

  // 检测是否是 arXiv 引用（跳过 arXiv ID 的卷期提取）
  const isArxivRef = /arXiv/i.test(s) || /arxiv\.org/i.test(s);

  // 模式1: Vol(Issue) - 排除 arXiv ID 格式
  const vi1 = s.match(/(\d+)\s*\(\s*(\d+)\s*\)/);
  if (vi1 && !isArxivRef) {
    volume = vi1[1];
    issue = vi1[2];
  }

  // 模式2: vol. X, no. Y
  const vi2 = s.match(/vol\.\s*(\d+)/i);
  if (vi2 && !volume) volume = vi2[1];
  const vi3 = s.match(/no\.\s*(\d+)/i);
  if (vi3) issue = vi3[1];

  // 模式3: Vol.Issue - 排除 arXiv ID 格式（如 1706.03762）
  if (!isArxivRef) {
    const vi4 = s.match(/\b(\d+)\.(\d+)\b/);
    if (vi4 && !volume) {
      // 排除 arXiv ID 格式（4位数.4-5位数）
      const p1 = vi4[1],
        p2 = vi4[2];
      if (!(p1.length === 4 && p2.length >= 4 && p2.length <= 5)) {
        volume = p1;
        issue = p2;
      }
    }
  }

  // 页码模式
  // pp. X-Y 或 p. X
  const pp1 = s.match(/pp?\.\s*(\d+)\s*[-–—]\s*(\d+)/i);
  if (pp1) {
    firstPage = pp1[1];
    lastPage = pp1[2];
  }

  // : X-Y
  const pp2 = s.match(/[:：]\s*(\d+)\s*[-–—]\s*(\d+)/);
  if (pp2 && !firstPage) {
    firstPage = pp2[1];
    lastPage = pp2[2];
  }

  // 通用 X-Y (排除年份范围)
  const pp3 = s.match(/\b(\d{1,5})\s*[-–—]\s*(\d{1,5})\b/);
  if (pp3 && !firstPage) {
    const n1 = parseInt(pp3[1], 10);
    const n2 = parseInt(pp3[2], 10);
    // 排除年份范围 (1900-2100)
    if (!(n1 >= 1900 && n1 <= 2100 && n2 >= 1900 && n2 <= 2100)) {
      firstPage = pp3[1];
      lastPage = pp3[2];
    }
  }

  return { volume, issue, firstPage, lastPage };
}

// 清理标题
function cleanTitle(title) {
  if (!title) return null;
  return title
    .replace(/\s+/g, " ")
    .replace(/^["'"「《]+/, "")
    .replace(/["'"」》]+$/, "")
    .replace(/[,，.。]+$/, "")
    .trim();
}

// 清理期刊名
function cleanJournal(journal) {
  if (!journal) return null;
  return journal
    .replace(/\s+/g, " ")
    .replace(/[,，.。:：]+$/, "")
    .replace(/^\s*in\s+/i, "")
    .trim();
}

// 清理作者列表
function cleanAuthors(authors) {
  return authors
    .map((a) => a.replace(/[,，.。]+$/, "").trim())
    .filter((a) => a && a.length >= 2 && !/^\d+$/.test(a));
}

// 标题回退提取
function extractTitleFallback(s, authors, journal) {
  // 移除作者和期刊部分，剩下的可能是标题
  let remaining = s;

  for (const author of authors) {
    remaining = remaining.replace(author, "");
  }
  if (journal) {
    remaining = remaining.replace(journal, "");
  }

  // 移除年份、卷期、页码
  remaining = remaining
    .replace(/\(?\d{4}\)?/g, "")
    .replace(/\d+\s*\(\d+\)/g, "")
    .replace(/\d+\s*[-–—]\s*\d+/g, "")
    .replace(/vol\.\s*\d+/gi, "")
    .replace(/no\.\s*\d+/gi, "")
    .replace(/pp?\.\s*\d+/gi, "");

  // 清理标点和多余空格
  remaining = remaining
    .replace(/[,，.。;；:：\[\]()（）]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 如果剩余内容足够长，可能是标题
  if (remaining.length >= 15) {
    return remaining;
  }

  return null;
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
  for (const [field, wt] of Object.entries(weights)) {
    const s = scores[field] ?? 0;
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
  for (const [field, wt] of Object.entries(weights)) {
    const s = scores[field] ?? 0;
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
  for (const [field, wt] of Object.entries(weights)) {
    const s = scores[field] ?? 0;
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
  for (const [field, wt] of Object.entries(weights)) {
    const s = scores[field] ?? 0;
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

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
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
  });

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
  const isArxiv = /arXiv/i.test(raw) || /\d{4}\.\d{4,5}/.test(raw);

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

  // 如果启用 AI 评分，调用 AI 进行评分（添加超时保护）
  if (useAiScoring && (oaBest?.best || crBest?.best)) {
    try {
      // 添加 30 秒超时
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("AI 评分超时")), 30000),
      );
      aiScoringResult = await Promise.race([
        scoreWithAI(raw, p, oaBest?.best, crBest?.best, isArxiv),
        timeoutPromise,
      ]);
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

  // 使用规则评分的字段顺序
  const allKeys = Object.keys(ruleDetails || aiDetails || {});

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

    const ruleScore = ruleVal?.score ?? 0;
    const aiScore = aiVal?.score ?? 0;

    ruleTotal += ruleScore * weight;

    if (aiDetails) {
      // 同时显示规则和 AI 评分
      rows += `
      <div class="score-tooltip-row">
        <span class="score-tooltip-label">${label} (${(weight * 100).toFixed(0)}%)</span>
        <span class="score-tooltip-value ${getScoreClass(ruleScore)}">${ruleScore.toFixed(2)}</span>
        <span class="score-tooltip-value ${aiVal ? getScoreClass(aiScore) : ""}">${aiVal ? aiScore.toFixed(2) : "-"}</span>
      </div>`;
    } else {
      // 只显示规则评分
      rows += `
      <div class="score-tooltip-row">
        <span class="score-tooltip-label">${label} (${(weight * 100).toFixed(0)}%)</span>
        <span class="score-tooltip-value ${getScoreClass(ruleScore)}">${ruleScore.toFixed(2)} × ${weight.toFixed(2)} = ${(ruleScore * weight).toFixed(3)}</span>
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

/** ---------- 主逻辑 ---------- */
document.getElementById("run").addEventListener("click", async () => {
  const btn = document.getElementById("run");
  const resultsDiv = document.getElementById("results");
  const progressDiv = document.getElementById("progress");
  const summaryDiv = document.getElementById("summary");

  const rawText = document.getElementById("citation").value;
  const mailto = document.getElementById("mailto").value.trim();

  // 智能分割输入：识别 BibTeX 条目（跨多行）和普通引用（单行）
  function smartSplitCitations(text) {
    const entries = [];
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
        // 普通引用，每行一条
        if (trimmed) {
          entries.push(trimmed);
        }
      }
    }

    // 处理最后一个条目
    if (currentEntry.trim()) {
      entries.push(currentEntry.trim());
    }

    return entries;
  }

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

  // 先创建所有占位符
  for (let i = 0; i < lines.length; i++) {
    resultsDiv.innerHTML += `
            <div class="processing-item" id="processing-${i}">
              <div class="processing-item-status">
                <span class="processing-item-status-dot"></span>
                <span id="status-${i}">等待处理</span>
              </div>
              <div class="processing-item-text">${esc(lines[i].slice(0, 80))}${lines[i].length > 80 ? "..." : ""}</div>
              <div class="processing-item-progress" id="progress-${i}" style="width: 0%"></div>
            </div>
          `;
  }

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
      const isArxiv = /arXiv/i.test(line) || /\d{4}\.\d{4,5}/.test(line);
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

      // 如果启用 AI 评分，调用 AI 进行评分（添加超时保护）
      if (useAiScoring && (oaBest?.best || crBest?.best)) {
        try {
          // 添加 30 秒超时
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("AI 评分超时")), 30000),
          );
          aiScoringResult = await Promise.race([
            scoreWithAI(line, parsed, oaBest?.best, crBest?.best, isArxiv),
            timeoutPromise,
          ]);
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
});

/** ---------- 文本整理功能 ---------- */
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
 * 检测一行是否是新条目的开始
 */
function detectNewEntry(line, currentEntry) {
  if (currentEntry.length === 0) return true;

  // 1. 以序号开头：[1], 1., 1), (1), [1]
  if (/^\s*[\[(]?\d+[\].):\s]/.test(line)) return true;

  // 2. 以作者名开头的常见模式
  // 中文作者：2-4个汉字开头
  if (/^[\u4e00-\u9fa5]{2,4}[,，.]/.test(line)) return true;

  // 西方作者：Lastname, F. 或 F. Lastname
  if (/^[A-Z][a-z]+,\s*[A-Z]\./.test(line)) return true;
  if (/^[A-Z]\.\s*[A-Z]?\.?\s*[A-Z][a-z]+/.test(line)) return true;

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

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
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
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `API 错误: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  return content.trim();
}

/** ---------- BibTeX 导出功能 ---------- */
// 显示提示消息
let _toastTimer = null;
let _toastCounterTimer = null;

function showToast(message, persistent = false) {
  const toast = document.getElementById("toast");
  clearTimeout(_toastTimer);
  clearInterval(_toastCounterTimer);
  toast.textContent = message;
  toast.classList.add("show");
  if (!persistent) {
    _toastTimer = setTimeout(() => toast.classList.remove("show"), 2000);
  }
}

function showPersistentToast(baseMessage) {
  const start = Date.now();
  showToast(`${baseMessage} (0.0s)`, true);
  _toastCounterTimer = setInterval(() => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    document.getElementById("toast").textContent =
      `${baseMessage} (${elapsed}s)`;
  }, 100);
}

function dismissPersistentToast(message) {
  clearInterval(_toastCounterTimer);
  _toastCounterTimer = null;
  showToast(message);
}

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

  // 提取模式下重置选择器为"全部"
  exportMode = "all";
  document
    .querySelectorAll(".export-option")
    .forEach((o) => o.classList.remove("active"));
  document
    .querySelector(".export-option[data-value='all']")
    .classList.add("active");
});

// 渲染仅提取的结果（不调用 API）
function renderExtractedResult(result, index) {
  const { raw, parsed } = result;

  return `
    <div class="result-item" data-index="${index}">
      <div class="result-header" onclick="toggleResult(${index})">
        <div class="result-index">${index + 1}</div>
        <div class="result-title">${esc(parsed.title || raw.slice(0, 80))}</div>
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

// 默认展开第一个结果
window.toggleResult = toggleResult;
window.copyBibTeX = copyBibTeX;
window.copyExtractedBib = copyExtractedBib;

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
    const response = await fetch(`${baseUrl}/chat/completions`, {
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
    });

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
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

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

// 点击外部关闭下拉列表
document.addEventListener("click", (e) => {
  const combo = document.getElementById("aiModelCombo");
  if (combo && !combo.contains(e.target)) {
    hideModelDropdown();
  }
});

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
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
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
    });

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
        format: "AI 解析",
      };
    }
  } catch (e) {
    console.error("AI 解析错误:", e);
  }

  return null;
}

// 温度滑块事件
document.getElementById("aiTemperature").addEventListener("input", (e) => {
  document.getElementById("aiTempValue").textContent = e.target.value;
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
    });
  }
  updateWeightDisplay();
})();

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
