/** ---------- 解析引用 ---------- */
// 检测是否为 arXiv 引用：关键字命中，或独立的 YYYY.NNNNN ID（不在 DOI / URL 中）
function detectArxiv(raw) {
  if (!raw) return false;
  if (/\barXiv\b/i.test(raw) || /\barxiv\.org\b/i.test(raw)) return true;
  // 剥除 DOI 和 URL 后再检测 arXiv ID 形式，避免 10.1109/LRA.2026.3678455 这类 DOI 误判
  const stripped = raw
    .replace(/\b10\.\d{4,9}\/[^\s,;"\]>]+/gi, "")
    .replace(/https?:\/\/[^\s]+/gi, "");
  return /(?:^|[\s\[(,;])\d{4}\.\d{4,5}(?=$|[\s\]);,.])/.test(stripped);
}

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
  // arXiv 格式检测：关键字或独立 arXiv ID（排除 DOI 中的数字）
  const hasArxivStyle = detectArxiv(s);

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

