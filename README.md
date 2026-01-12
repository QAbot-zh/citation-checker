# 引用真伪快速校验

通过 OpenAlex 与 Crossref 双数据源交叉验证，智能解析引用字段并评估学术引用的可信度。支持批量校验、批量生成 BibTeX，每行一条引用。

[**演示站点**](https://citation.octozh.de)

![校验结果示例](results.png)

## 功能特点

- 双数据源验证：同时查询 OpenAlex 和 Crossref
- 多格式解析：支持 GB/T 7714、APA、MLA、IEEE、Chicago、Vancouver、Harvard 等主流格式
- 智能字段解析：自动提取标题、作者、期刊、年份、卷期、页码、DOI
- 可信度评分：基于多维度匹配计算综合得分
- 批量处理：支持多条引用同时校验
- BibTeX 生成：支持快速生成和导出 BibTeX 格式
- 无需后端：纯前端实现，直接调用公开 API

## 使用方法

### 本地浏览器打开

1. 下载或克隆本项目
2. 直接双击 `index.html` 文件，用浏览器打开即可使用
3. 或者右键 `index.html` → 打开方式 → 选择浏览器

> 由于本工具为纯前端实现，无需启动任何服务器，直接用浏览器打开 HTML 文件即可正常运行。

### Cloudflare Pages 部署

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** → **Create application** → **Pages**
3. 选择 **Connect to Git** 或 **Direct Upload**

**方式一：连接 Git 仓库**
- 连接你的 GitHub/GitLab 账号
- 选择包含本项目的仓库
- 构建设置保持默认（无需构建命令）
- 点击 **Save and Deploy**

**方式二：直接上传**
- 选择 **Upload assets**
- 将 `index.html` 文件拖拽上传
- 点击 **Deploy site**

部署完成后，Cloudflare 会提供一个 `*.pages.dev` 域名，也可绑定自定义域名。

## 功能操作

### 校验引用

1. 在左侧文本框粘贴引用（每行一条）
2. 可选：填写联系邮箱以获得更稳定的 API 响应
3. 点击「开始校验」调用 API 验证引用真实性

### 生成 BibTeX

无需校验可直接生成 BibTeX：

1. 粘贴引用后，点击「生成 BibTeX」
2. 系统直接解析引用字段，生成对应 BibTeX
3. 可单条复制或批量导出

### 导出 BibTeX

校验或生成完成后，可通过导出区域获取 BibTeX：

- **全部**：导出所有条目
- **高可信**：仅导出可信度为"高"的条目（校验模式下）
- **下载 BibTeX**：下载为 `.bib` 文件
- **复制 BibTeX**：复制到剪贴板

## 可信度等级

| 等级 | 分数范围 | 说明 |
|------|----------|------|
| 高可信 | ≥ 0.78 | 强匹配，引用基本可信 |
| 中可信 | 0.55 - 0.78 | 部分匹配，建议核对 |
| 低可信 | < 0.55 | 匹配度低，可能伪造 |

## 评分算法

综合评分基于以下字段加权计算：

| 字段 | 权重 | 计算方式 |
|------|------|----------|
| 标题 | 45% | Jaccard 相似度 |
| 作者 | 15% | 姓氏匹配 + Jaccard |
| 期刊 | 12% | 编辑距离 + 前缀匹配 |
| 年份 | 10% | 精确匹配 |
| 卷号 | 6% | 精确匹配 |
| 期号 | 4% | 精确匹配 |
| 页码 | 8% | 精确匹配 |

综合分 = max(OpenAlex, Crossref) × 0.6 + min(OpenAlex, Crossref) × 0.4

## 提示

- 提供联系邮箱可进入 OpenAlex/Crossref 的 polite pool，获得更稳定的 API 响应
- 每行粘贴一条引用，空行会被自动忽略
- 点击结果条目可展开查看详细的解析和匹配信息
- 悬停在评分上可查看各字段的详细得分

## 许可

MIT License
