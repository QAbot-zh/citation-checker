# 引用真伪快速校验

通过 OpenAlex 与 Crossref 双数据源交叉验证，智能解析引用字段并评估学术引用的可信度。支持批量校验，每行一条引用。

**演示站点:** [https://citation.octozh.de](https://citation.octozh.de)

![校验结果示例](results.png)

## 功能特点

- 双数据源验证：同时查询 OpenAlex 和 Crossref
- 智能字段解析：自动提取标题、作者、期刊、年份、卷期、页码、DOI
- 可信度评分：基于多维度匹配计算综合得分
- 批量处理：支持多条引用同时校验
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

## 可信度等级

| 等级 | 分数范围 | 说明 |
|------|----------|------|
| 高可信 | ≥ 0.78 | 强匹配，引用基本可信 |
| 中可信 | 0.55 - 0.78 | 部分匹配，建议核对 |
| 低可信 | < 0.55 | 匹配度低，可能伪造 |

## 提示

- 提供联系邮箱可进入 OpenAlex/Crossref 的 polite pool，获得更稳定的 API 响应
- 每行粘贴一条引用，空行会被自动忽略
- 点击结果条目可展开查看详细的解析和匹配信息

## 许可

MIT License
