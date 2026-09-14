# ARGUS+

ARGUS+ 是一个法律训练产品原型，当前采用前后端分离的工作区结构：

- `frontend/`：Next.js App Router + React + TypeScript，默认运行在 `3000` 端口。
- `backend/`：独立 Node.js HTTP API，默认运行在 `4000` 端口。
- `frontend/app/`：唯一的 Next.js App Router 页面实现。
- `supabase/schema.sql`：玩家档案、闯关记录和排行榜视图。

## 快速开始

```bash
npm install
npm run dev
```

打开 <http://localhost:3000>。前端优先通过 `NEXT_PUBLIC_API_BASE_URL` 访问 Node.js 服务；未配置时请求同源的 `/argus-api`，再由 Next.js 使用 `ARGUS_BACKEND_URL` 转发（默认后端为 `http://localhost:4000`）。

配置 Supabase 后，可从右上角玩家入口选择注册或登录；匿名访客也能直接试玩，不会被注册窗口拦截。登录后可在玩家档案中选择预设头像。用户名会在 `player_profiles` 中做不区分大小写查重，玩家档案、胜局分数和排行榜会同步到项目 `tshojzkaojcehjunhbju`。未配置 anon key 时仍保留本机试玩模式。

也可以分别启动：

```bash
npm run dev:backend
npm run dev:frontend
```

## Vercel + 独立 Node.js 部署

前端目标平台为 Vercel，后端保持为独立 Node.js 服务。当前仓库是 monorepo，创建 Vercel
项目时将 **Root Directory** 设置为 `frontend/`，框架选择 Next.js，构建命令使用默认的
`next build`。配置文件位于 `frontend/vercel.json`。

部署步骤：

1. 将仓库导入 Vercel，Root Directory 选择 `frontend/`。
2. 在 Vercel 的 Production、Preview 环境分别配置 `NEXT_PUBLIC_API_BASE_URL`，生产值使用 `https://argus-api.tomeet.chat`。
3. 在 Vercel/Zeabur 的前端环境变量中配置 `NEXT_PUBLIC_SUPABASE_URL=https://tshojzkaojcehjunhbju.supabase.co`，再配置 Supabase Dashboard → Project Settings → API 中的 Publishable key（旧版名称为 `anon key`，代码支持 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 或 `NEXT_PUBLIC_SUPABASE_ANON_KEY`）。
4. 前端不会要求用户填写或验证 Email。由于 Supabase Auth 的密码接口底层需要一个唯一 identity，代码会把用户名编码成不可见的 `argus.local` 内部标识；请在 Supabase Auth → Providers 中开启 Email、关闭 Confirm email，不会向用户展示或发送 Email。若完全关闭 Email provider，则需要改成自建服务端账号系统。
5. 在 Supabase SQL Editor 中执行 [`supabase/schema.sql`](supabase/schema.sql)，创建玩家档案、用户名唯一索引、闯关记录、RLS 策略和排行榜视图。
6. 将 `backend/` 部署到支持常驻 Node.js 进程的平台（例如 Render、Railway、Fly.io 或自有服务器）。
7. 在后端配置 `CORS_ORIGIN`。多个 Vercel 生产/预览域名用英文逗号分隔，例如：

   ```env
   CORS_ORIGIN=https://argus.vercel.app,https://argus-git-main-988ms.vercel.app
   ```

Vercel 前端使用根路径 `/`，不再需要 GitHub Pages 的 `/ARGUS` `basePath` 和静态导出。
每个 Pull Request 可以自动生成 Preview，前端 API 地址通过 Vercel 环境变量在构建时注入。

## API

- `GET /health`：服务健康检查
- `GET /api`：服务版本和路由清单
- `POST /api/cases/draft`：根据案件概念生成案件草案
- `POST /api/contracts/audit`：执行首版规则合同审查
- `GET /api/zhihu/stories`：实时读取知乎黑客松故事目录，并标记已编排的互动案卷
- `GET /api/zhihu/stories/:workId/case`：读取故事详情并生成可进入现有搜证/质证流程的案卷

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
backend/src/        Node.js API 与测试
legacy/             旧版静态页面快照
.framework/         迁移验证与回滚工件
```

## MVP 与独立服务器

当前 MVP 已实现四个可操作模块：案件工坊、合同猎魔、租赁押金法庭闯关、社区广场。后端新增案件草案、逐条审查、完整原件搜证、动态质证、解释性裁判和脱敏发帖 API。

后端可以部署在你自己的 `api.tomeet.chat` 服务器。详细的 Docker Compose、Nginx、HTTPS 和环境变量步骤见 [`deploy/README.md`](deploy/README.md)。
