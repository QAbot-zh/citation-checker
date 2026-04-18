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


/** ---------- 通用工具：剪贴板 / 下载 / 请求 ---------- */
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

// 带超时的 fetch：超时后通过 AbortController 真正中止请求，避免僵尸连接
async function fetchWithTimeout(input, init = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}s）`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}


/** ---------- Toast 提示 ---------- */
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
