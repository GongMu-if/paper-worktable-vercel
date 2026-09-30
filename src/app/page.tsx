# V3 白色统一首页版 · 学术文献智能工作台

保留原平台名称，使用白色背景、浅灰边框和深灰文字。主页加入简洁的白色书页自然光背景，并以四张卡片说明每种业务的用途。卡片点击进入独立业务页面。

## 页面结构

- /：新的统一首页，无需登录即可浏览工具介绍。
- /search：文献检索，复用原工作台的登录、检索、反馈和归档功能。
- /reading：论文精读，复用原工作台的登录、上传、解析和报告功能。
- /introduction：保留原有引言写作页面。
- /reviewer：保留原有批量审稿页面。
- /workspace：原有完整检索与精读工作台，保留历史记录入口。

首页从原工作台调整为工具入口；原工作台可通过「我的工作区」继续使用。各业务仍使用原有认证机制，不会绕过登录，也未合并原本不同的账号流程。

## 使用方法

先备份原项目，再使用「V3-白色版更新包.zip」。解压后把 src 和 public 两个目录合并到项目根目录，覆盖同名文件。不要删除整个旧 src；public 中的背景图片必须一起复制。

也可直接使用「V3-白色版完整源码.zip」，解压后恢复原有环境变量，按原部署方式安装和构建：

    npm install
    npm run build
    npm run start

依赖清单未改变，没有添加 npm 依赖。源码包不含 node_modules、.next、预览测试账号或本地测试工具。不包含生产环境变量，请继续使用原配置。此次没有上传 GitHub 或部署到线上。

## 修改范围

修改 5 个原文件：
- src/app/page.tsx：统一首页及业务摘要卡片。
- src/app/globals.css：白色主题、背景与响应式布局。
- src/components/Workbench.tsx：增加 tool 展示参数，分别展示检索或精读表单；补充首页导航与背景。
- src/app/introduction/page.tsx：增加统一导航。
- src/app/reviewer/page.tsx：增加统一导航。

新增 5 个文件：
- src/components/ResearchNav.tsx
- src/app/search/page.tsx
- src/app/reading/page.tsx
- src/app/workspace/page.tsx
- public/images/research-white.png

## 验证结果和边界

- npm run build 成功，TypeScript 检查通过，新增三个路由正确生成。
- src/app/api、src/lib 及 package.json、next.config.ts、tsconfig.json 共 27 个文件与最初提供的 ZIP 逐字节一致。
- TypeScript AST 对比：显式排除新增的 tool 展示参数、导航 import 和 JSX 展示内容后，三个修改页面原有业务代码一致；118 个原有事件绑定、值绑定、禁用条件、ref、文件格式等行为属性一致。
- 静态渲染验证：/search 只显示文献检索表单，/reading 只显示论文精读表单，/workspace 保留原工作台。
- 浏览器验证：四张首页卡片跳转到正确路由；返回首页及工作区入口可用。桌面和 390px 手机布局已检查。
- 文献检索和论文精读页的业务区效果图使用离线示例账号渲染，仅验证布局，不调用真实任务接口。
- 没有连接生产账号进行登录、上传、任务处理、结果导出的端到端回归。本地没有配置真实后端，不能据此声称生产业务已经验证。请在原环境验证以上流程后上线。

## 图片来源

使用内置 image_gen 工具生成，最终选用白色书页图片，未使用之前被否定的蓝色图或复杂图。图片随项目本地打包，不依赖第三方图片链接。
项目文件：public/images/research-white.png
单独交付：V3-白色书页背景.png
最终提示词：

Minimal editorial photograph for a white academic website banner. Panoramic 2.5:1 composition. One plain white open paperback book at the far right on a pure white matte desk, soft natural daylight from a window, gentle neutral grey shadows and faint soft window shadow. White wall background, white-on-white palette, no blue tint, no green, no colored tint, no beige or yellow tint. Left 65 percent calm nearly white for dark text overlay. Photorealistic tactile paper, light airy understated composition. No objects other than the book, no decorations, no floating objects, no glass, no metallic elements, no landscape. No legible text, no logos, no watermark, no UI. Simple and clean.
