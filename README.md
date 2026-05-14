# 学术文献智能工作台 - Vercel / Next.js 前端

这是从 Streamlit 前端迁移出来的 Vercel 前端项目。它复用你后端已经暴露的两个入口：

- `frontend_backend_rpc`：通用业务 RPC，用于登录、注册、历史记录、任务状态、文献检索等。
- `frontend_submit_analysis_job`：PDF 精读任务上传入口。

## 目录结构

```txt
src/app/page.tsx                    # 首页
src/app/api/rpc/route.ts             # Vercel 服务端代理：前端 RPC
src/app/api/analysis-upload/route.ts # Vercel 服务端代理：PDF 上传
src/components/Workbench.tsx         # 主工作台 UI
src/components/MarkdownReport.tsx    # Markdown + 图片渲染
src/lib/api.ts                       # 前端 API 封装
src/lib/hash.ts                      # PDF cache_key 计算
src/lib/types.ts                     # 类型定义
```

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local` 示例：

```env
BACKEND_RPC_API_URL=https://你的-modal-app--frontend-backend-rpc.modal.run
FRONTEND_SUBMIT_ANALYSIS_JOB_URL=https://你的-modal-app--frontend-submit-analysis-job.modal.run
```

## Vercel 部署

1. 把本项目推到 GitHub。
2. Vercel Import Project。
3. Framework 选择 Next.js。
4. 添加环境变量：

```env
BACKEND_RPC_API_URL=https://你的-modal-app--frontend-backend-rpc.modal.run
FRONTEND_SUBMIT_ANALYSIS_JOB_URL=https://你的-modal-app--frontend-submit-analysis-job.modal.run
```

5. Deploy。

## PDF 上传说明

默认代码会通过 `/api/analysis-upload` 由 Vercel 服务端代理上传到 Modal，这样浏览器不会直接接触 Modal 上传地址。

如果你的 PDF 很大，Vercel Function 可能遇到请求体限制。此时可以给 Modal 的 `frontend_submit_analysis_job` endpoint 配置 CORS，然后在 Vercel 添加：

```env
NEXT_PUBLIC_DIRECT_ANALYSIS_UPLOAD_URL=https://你的-modal-app--frontend-submit-analysis-job.modal.run
```

这样浏览器会直接上传 PDF 到 Modal，绕过 Vercel 的上传代理限制。

## 当前后端兼容性

本前端调用的 RPC action 包括：

- `public_config`
- `ensure_app_storage`
- `register_user`
- `authenticate_user`
- `load_user_report_index`
- `get_user_job_state`
- `get_user_job_by_cache_key`
- `update_analysis_job_status`
- `create_or_reuse_analysis_job`
- `load_agent_logs`
- `load_user_report_record`
- `get_user_cached_report`
- `load_user_search_index`
- `get_user_search_job_state`
- `load_user_search_record`
- `create_paper_search_job`
- `update_paper_search_job_status`
- `mark_paper_search_job_superseded`
- `submit_paper_search_job`
- `finalize_paper_search_job`
- `normalize_report_markdown`

这些 action 对应你第 7 步后的 `backend/jobs/modal_jobs.py`。
