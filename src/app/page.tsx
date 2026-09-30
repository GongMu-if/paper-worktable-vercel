import Image from "next/image";
import { ResearchNav } from "@/components/ResearchNav";

const services = [
  { id: "search", number: "01", name: "文献检索", href: "/search", lead: "从一个问题，找到相关研究。", summary: "输入研究主题与筛选偏好，获取候选文献；支持反馈修正，让检索结果更贴近你的课题。", tags: ["主题检索", "筛选与反馈"], path: "M21 21l-5-5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" },
  { id: "reading", number: "02", name: "论文精读", href: "/reading", lead: "读懂方法，也读懂背后的思路。", summary: "上传一篇或多篇论文 PDF，生成结构化精读报告，梳理研究内容，并保存到账号档案。", tags: ["PDF 解析", "报告导出"], path: "M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2V4Z" },
  { id: "introduction", number: "03", name: "引言写作", href: "/introduction", lead: "让研究创新，成为清晰的表达。", summary: "上传参考论文并填写创新点，结合文献证据生成英文 Introduction，通过审查与修改完善初稿。", tags: ["参考文献驱动", "英文引言"], path: "m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14v6ZM13 21h8" },
  { id: "reviewer", number: "04", name: "批量审稿", href: "/reviewer", lead: "以审稿视角，重新审视论文。", summary: "批量上传待审论文，辅助判断期刊适配性，整理整体评价、中文评语与英文学术翻译。", tags: ["批量处理", "中英审稿意见"], path: "M8 3h10a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2Zm0 5h8m-8 5 2 2 5-5M8 18h8" },
];

export default function Home() {
  return (
    <div className="portal-shell">
      <ResearchNav active="home" />
      <main>
        <section className="portal-hero" aria-labelledby="portal-title">
          <Image className="portal-hero-image" src="/images/research-white.png" alt="" fill priority sizes="(max-width: 1600px) 100vw, 1536px" />
          <div className="portal-hero-copy">
            <p className="portal-kicker"><span /> 一站式学术研究空间</p>
            <h1 id="portal-title">专注思考，<br />让研究有序发生。</h1>
            <p className="portal-hero-description">从文献检索到论文精读，从引言写作到审稿辅助。<br />选择你需要的工具，开始下一步研究。</p>
            <a className="portal-cta" href="#services">选择研究工具 <span aria-hidden="true">↓</span></a>
          </div>
          <span className="portal-hero-caption">阅读 · 理解 · 写作 · 审视</span>
        </section>

        <section className="portal-services" id="services" aria-labelledby="services-title">
          <div className="portal-section-heading">
            <div><p className="portal-section-label">研究工具</p><h2 id="services-title">从你现在的任务开始</h2></div>
            <p>四种工具，一条连贯的研究路径。</p>
          </div>
          <div className="service-grid">
            {services.map(service => (
              <a className={`service-card service-${service.id}`} href={service.href} key={service.id} aria-label={`进入${service.name}`}>
                <div className="service-card-top"><span className="service-icon"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={service.path} stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" /></svg></span><span className="service-number">{service.number}</span></div>
                <h3>{service.name}</h3>
                <p className="service-lead">{service.lead}</p>
                <p className="service-summary">{service.summary}</p>
                <div className="service-tags">{service.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
                <div className="service-entry">进入{service.name}<span aria-hidden="true">↗</span></div>
              </a>
            ))}
          </div>
        </section>

        <section className="portal-continuity" aria-label="继续已有研究">
          <div className="continuity-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 5h16v14H4V5Zm4-3v5m8-5v5M8 11h8m-8 4h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg></div>
          <div><h2>每一次研究，都有迹可循。</h2><p>回到工作区，查看文献检索记录与已保存的精读报告。</p></div>
          <a href="/workspace">打开我的工作区 <span aria-hidden="true">→</span></a>
        </section>
      </main>
      <footer className="portal-footer"><span>学术文献智能工作台</span><span>让工具处理繁复，让思考回归研究。</span></footer>
    </div>
  );
}
