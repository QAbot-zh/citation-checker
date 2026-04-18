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
  refreshAllResults();
}
