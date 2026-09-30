type ResearchNavProps = { active: "home" | "search" | "reading" | "workspace" | "introduction" | "reviewer" };

export function ResearchNav({ active }: ResearchNavProps) {
  const links = [
    { id: "home", href: "/", label: "首页" },
    { id: "search", href: "/search", label: "文献检索" },
    { id: "reading", href: "/reading", label: "论文精读" },
    { id: "introduction", href: "/introduction", label: "引言写作" },
    { id: "reviewer", href: "/reviewer", label: "批量审稿" },
  ];
  return (
    <nav className="research-nav" aria-label="研究工具导航">
      <a className="research-brand" href="/" aria-label="学术文献智能工作台首页">
        <svg className="brand-symbol" aria-hidden="true" viewBox="0 0 32 32" fill="none"><rect x="8" y="4" width="18" height="23" rx="3" stroke="currentColor" strokeWidth="1.6" /><path d="M5 9v16a5 5 0 0 0 5 5M13 11h8M13 16h8M13 21h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        <span>学术文献智能工作台</span>
      </a>
      <div className="research-nav-links">
        {links.map(link => <a key={link.id} href={link.href} aria-current={active === link.id ? "page" : undefined}>{link.label}</a>)}
        <a className="workspace-nav-link" href="/workspace" aria-current={active === "workspace" ? "page" : undefined}>我的工作区 <span aria-hidden="true">↗</span></a>
      </div>
    </nav>
  );
}
