# ARGUS+

ARGUS+ 是一个法律训练产品原型，当前采用前后端分离的工作区结构：

- `frontend/`：Next.js App Router + React + TypeScript，默认运行在 `3000` 端口。
- `backend/`：TypeScript + ESM 独立 Node.js HTTP API，默认运行在 `4000` 端口。
- `frontend/app/`：唯一的 Next.js App Router 页面实现。
- `supabase/schema.sql`：玩家档案、闯关记录和排行榜视图。

## 快速开始

需要 Node.js **22.18+**。后端源码、关卡数据和测试全部使用 TypeScript；开发与测试通过 Node 原生类型擦除运行，生产通过 `tsc` 编译后运行，无额外运行时依赖。前端保留用于即时动画的同构战斗规则，最终胜负仍由后端签名票据回放判定。

```bash
npm ci
# 仅首次配置；已有文件不覆盖，沿用同一个 Supabase 项目的凭据：
cp -n backend/.env.example backend/.env
cp -n frontend/.env.example frontend/.env.local
npm run dev
```

打开 <http://localhost:3000>。默认通过同源 `/argus-api` 代理访问后端 `http://localhost:4000`；也可设置 `NEXT_PUBLIC_API_BASE_URL` 直接访问独立后端。npm 后端脚本会读取 `backend/.env`，已有环境变量优先。

匿名访客可以直接试玩《蓝血》完整流程；登录后才会把玩家档案、胜局分数和排行榜同步到 Supabase。Supabase Auth 负责账号认证；浏览器只持有 Supabase 的认证会话，档案与成绩由后端通过 service role 写入，前端不能直接修改分数。玩家可从右上角入口注册、登录并选择预设头像，用户名在 `player_profiles` 中不区分大小写查重。

未配置前端 Supabase URL/key 时为本地练习模式，不创建云端账号；本地分数不会在登录后上传。首次登录由后端按 Auth 用户 ID 自动建立零分档案，昵称与认证身份绑定，档案编辑只允许更换预设头像。

## Supabase Auth 配置与安全边界

已有登录环境不需要重新申请项目或密钥。`frontend/.env.production` 中的 URL 和 publishable/anon key 可以沿用；`next dev` 不读取该文件，本地开发使用 `frontend/.env.local`。登录 Supabase 控制台也不会自动把配置写入应用。

本次后端安全改造额外需要 `SUPABASE_SERVICE_ROLE_KEY`（用于后端档案读写和成绩结算）及 `CAMPAIGN_SIGNING_KEY`（本应用的对局签名密钥，不是 Supabase 凭据）。两者仅放在后端；前后端的公开项目地址和 key 应保持一致。已有后端密钥应沿用，不要随意轮换。环境文件已被 Git 忽略，不会自动同步到部署平台。

1. 在 Supabase 开启 **Email provider**，关闭 **Confirm email**，将最短密码设为至少 **8 位**。前端校验不能替代 Auth 服务端策略；同时配置 Supabase 自带登录/注册频率限制。此实现没有验证码 UI，若开启 CAPTCHA，需要另行接入对应挑战令牌。
2. 现有产品保留“用户名 + 密码”：用户名经 NFKC 规范化、忽略大小写，再映射到内部 `argus.local` 邮箱身份。较长 Unicode 名称使用 SHA-256，避免超过邮箱长度限制；兼容原型已有身份。**这些不是可收信邮箱，因此没有邮件确认或邮件找回密码能力**。不要为这种身份配置真实收信流程；已产生的未确认账号需要管理员单独处理，关闭确认开关不会自动确认它们。
3. 后端配置 `SUPABASE_URL`、`SUPABASE_ANON_KEY`（也支持 `SUPABASE_PUBLISHABLE_KEY`）、`SUPABASE_SERVICE_ROLE_KEY`；前端仅配置 URL 和 publishable/anon key。项目必须一致，service role key 不得进入浏览器、源码或 `NEXT_PUBLIC_*`。
4. 在同一发布窗口内执行 [`supabase/schema.sql`](supabase/schema.sql) 并切换新版前后端。**旧版浏览器仍直接写表时，不要单独提前迁移**：先确认备份和发布方案、暂停旧版写入，迁移后切换新版本并验证。迁移使用事务，可重复执行；撤销客户端对档案、成绩表及计分 RPC 的权限，排行榜视图明确只读。若旧表存在大小写重复昵称，唯一索引会使迁移回滚：先人工解决归属，不要直接删除玩家记录。迁移保留历史分数及重复胜局，不代表历史分数已通过新规则审计。
5. 生产环境设置随机、稳定的 `CAMPAIGN_SIGNING_KEY`（至少 32 字符，可用 `openssl rand -hex 32` 生成），多副本必须一致。未配置时启动生成临时密钥，重启会使尚未结算的对局失效。

后端使用 Supabase `/auth/v1/user` 验证 Bearer Token，用户 ID/昵称不采信请求体或任意 `user_metadata`。验证有 5 秒超时、并发请求合并及最多 1024 项缓存，缓存最长 60 秒且不越过 JWT 过期时间。账户状态更新可能有该缓存窗口；Supabase 登出主要撤销刷新令牌，已签发 Access Token 通常仍可用到期，建议设置较短有效期（例如 15 分钟）。不使用自建登录 Cookie 或第二套会话系统。

每局由后端签发绑定账号、案件、证据和随机种子的 30 分钟凭证。前端即时播放动画，裁决与计分时后端复算合法出牌、体力、护盾和反击；客户端传入的胜负、分数和等级不参与计分。胜局每关仅奖励一次，数据库行锁确保重试和并发写入不会重复加分，也不会被头像更新覆盖。游客开局不能转为登录账号结算，需要登录后重新开局。

这不是反机器人系统：合法动作序列仍可被脚本求解，前端倒计时也不是可信的真人操作证明。接口按连接 IP 做有界内存限流，不信任客户端自行提供的代理 IP 头；生产反向代理/CDN 还需按真实客户端 IP 统一限流，使用 HTTPS 并妥善保护密钥。浏览器使用 Supabase SDK 持有会话，仍需防范 XSS；当前安全响应头不等同于完整的严格脚本 CSP。

## 验证

```bash
npm test                   # 前后端单元与 HTTP 边界测试（Supabase Auth 使用测试替身）
npm run typecheck          # 前后端严格类型检查，后端测试也在检查范围内
npm run build              # 后端编译至 backend/dist，再构建 Next.js 前端
npm run test:database      # Docker 中独立 PostgreSQL 16：迁移、权限与并发写入
```

数据库测试自动创建并移除临时容器，不读取线上 Supabase 配置。上线仍需在实际项目验证：注册、登录、刷新、退出、首次建档、修改头像、一次胜局及重复请求；同时用 anon/authenticated 身份确认直接写表、写排行榜和调用计分 RPC 都被拒绝。本地测试不能替代真实项目联调。

也可以分别启动：

```bash
npm run dev:backend
npm run dev:frontend
```

单独构建及启动生产后端：

```bash
npm run build:backend
npm run start:backend      # 运行 backend/dist/server.js，并读取 backend/.env
```

`npm run dev:backend` 直接监听 TypeScript 源码，不需要预构建；类型检查仍需运行 `npm run typecheck`。`backend/dist/` 为生成目录，不提交到 Git；后端编译会将 `.ts` / `.mts` 导入分别改写为 `.js` / `.mjs`，不将测试打入生产产物。

## Vercel 部署

线上 Demo 使用两个 Vercel 项目：前端 Root Directory 为 `frontend/`，后端 Root Directory
为 `backend/`。前端通过同源 `/argus-api` 转发至后端，配置分别位于
`frontend/vercel.json` 与 `backend/vercel.json`。

部署步骤：

1. 将仓库导入 Vercel，Root Directory 选择 `frontend/`；前端包可独立完成生产构建。
2. 前端保持 `NEXT_PUBLIC_API_BASE_URL=/argus-api`，由 Vercel 重写访问后端，避免浏览器跨域依赖。
3. 按上述发布窗口要求安排 [`supabase/schema.sql`](supabase/schema.sql)，不要在旧版仍提供写入时单独执行。
4. 在后端配置 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 和 `SUPABASE_ANON_KEY`。service role key 只能放在后端 Secret，不能配置为 `NEXT_PUBLIC_*`。
5. 前端配置 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`（或旧名称 `NEXT_PUBLIC_SUPABASE_ANON_KEY`）以及 `NEXT_PUBLIC_API_BASE_URL`，并完成上面的 Auth 配置。环境变量变更后需重新构建前端。
6. 将 `backend/` 部署为独立 Vercel 项目；也可使用 Render、Railway、Fly.io 或自有 Node.js 服务器。
7. 若前端改为直连后端，则在后端配置 `CORS_ORIGIN`。多个生产/预览域名用英文逗号分隔，例如：

   ```env
   CORS_ORIGIN=https://argus.vercel.app,https://argus-git-main-988ms.vercel.app
   ```

Vercel 前端使用根路径 `/`，不再需要 GitHub Pages 的 `/ARGUS` `basePath` 和静态导出。
每个 Pull Request 可以自动生成 Preview，前端 API 地址通过 Vercel 环境变量在构建时注入。

当前生产体验地址：<https://zhihucat-six.vercel.app/campaign>。

## API

- `GET /health`：服务健康检查
- `GET /api`：服务版本和路由清单
- `POST /api/cases/draft`：根据案件概念生成案件草案
- `POST /api/contracts/audit`：执行首版规则合同审查
- `GET /api/zhihu/stories`：实时读取知乎黑客松故事目录，并标记已编排的互动案卷
- `GET /api/zhihu/stories/:workId/case`：读取故事详情并生成可进入现有搜证/质证流程的案卷
- `GET/PUT /api/profile`、`POST /api/campaign/runs`、`GET /api/leaderboard`：后端账号和成绩接口
- `GET /api/auth/username-available?username=...`：查询用户名是否可用
- `POST /api/campaign/battles`：传入 `caseId`、`evidenceIds`，返回开局 `ticket` 和 `seed`
- `POST /api/campaign/verdict`：传入 `ticket`、`actions` 复算裁决；`actions` 是出牌实例 ID 数组，`null` 表示超时
- `POST /api/campaign/runs`：使用同样的凭证及 Bearer Token 结算；不接受客户端分数或玩家 ID

示例：

```bash
curl http://localhost:4000/health
curl -X POST http://localhost:4000/api/cases/draft \
  -H 'Content-Type: application/json' \
  -d '{"concept":"租客退租后房东扣留押金3000元"}'
```

上述黑客松故事接口不需要 Access Secret 或 OAuth。服务端只在请求期间读取官方活动 API，显式返回
`Cache-Control: no-store`，不会把故事正文写入仓库或持久化。目前唯一完成编排并可完整试玩的案卷
是《蓝血》（Work ID `2025684191967294692`）；目录中的其他故事只用于展示扩展能力，不会伪装成
已经可玩的内容。

《蓝血》的单故事流程为：故事入口 → 三场景搜证 → 六选四组牌 → 质证 → 三种假说或“证据不足”
的阶段判断 → 选择一条向知乎求证的问题 → 封存案卷。所有结论只比较公开片段内的解释力，不续写
故事，也不代表原作结局。

在线时，故事列表通过 `data.source=zhihu-live`、案卷通过 `data.source.mode=zhihu-live` 标记实时来源；
上游不可用时两者明确标记为 `curated-fallback`，原文锚点未命中则只显示“策划转述”，不会冒充实时
原文。案卷中的 `source.originalUrl` 用于打开已核验的知乎原作章节，`source.apiUrl` 仅用于标识本次
内容接口，两者不会混用。

## 当前边界

四个工作区统一使用 Next.js App Router + React 实现，并通过独立 URL 访问：`/forge`、`/audit`、`/campaign`、`/community`。后端保持为独立 Node.js HTTP 服务，前端只通过统一的 JSON 请求适配器访问 API。

## 目录约定

```text
frontend/app/       页面、布局和全局样式
frontend/public/    前端静态资源
backend/src/        TypeScript API、数据模型、共用战斗规则与测试
backend/dist/       后端生产构建产物（自动生成）
legacy/             旧版静态页面快照
.framework/         迁移验证与回滚工件
```

## MVP 与独立服务器

当前 MVP 已实现四个可操作模块：案件工坊、合同猎魔、租赁押金法庭闯关、社区广场。后端新增案件草案、逐条审查、完整原件搜证、动态质证、解释性裁判和脱敏发帖 API。

后端可以部署在你自己的 `api.tomeet.chat` 服务器。详细的 Docker Compose、Nginx、HTTPS 和环境变量步骤见 [`deploy/README.md`](deploy/README.md)。
