import { backendRpc, getWorkbenchBootstrap } from "./api";
import type { ReportMeta } from "./types";

type Bootstrap = Awaited<ReturnType<typeof getWorkbenchBootstrap>>;
type Title = Pick<ReportMeta, "report_id" | "report_title">;
type Entry = {
  value?: Bootstrap;
  loadedAt: number;
  revision: number;
  pending?: Promise<Bootstrap>;
  titlePending?: Promise<Title[]>;
  titleAttemptAt: number;
};

// Metadata only, held in this tab's memory. Never persist report contents or share users' caches.
const entries = new Map<string, Entry>();
const keyFor = (username: string) => username.trim().toLowerCase();

function entryFor(username: string): Entry {
  const key = keyFor(username);
  let entry = entries.get(key);
  if (!entry) {
    if (entries.size >= 4) entries.delete(entries.keys().next().value!);
    entry = { loadedAt: 0, revision: 0, titleAttemptAt: 0 };
    entries.set(key, entry);
  }
  return entry;
}

export function clearWorkbenchCache(): void { entries.clear(); }

export function peekWorkbench(username: string): Bootstrap | undefined {
  return entries.get(keyFor(username))?.value;
}

export function fetchWorkbench(username: string, force = false): Promise<Bootstrap> {
  const entry = entryFor(username);
  if (!force && entry.pending) return entry.pending;
  if (!force && entry.value && Date.now() - entry.loadedAt < 30_000) return Promise.resolve(entry.value);
  const revision = ++entry.revision;
  const request = getWorkbenchBootstrap(username).then(value => {
    if (entries.get(keyFor(username)) === entry && revision === entry.revision) {
      entry.value = value;
      entry.loadedAt = Date.now();
    }
    return value;
  }).finally(() => {
    if (entry.pending === request) entry.pending = undefined;
  });
  entry.pending = request;
  return request;
}

export function mergeReportTitles(reports: ReportMeta[], titles: Title[]): ReportMeta[] {
  const byId = new Map(titles.filter(item => item.report_title).map(item => [item.report_id, item.report_title]));
  return reports.map(item => byId.has(item.report_id) ? { ...item, report_title: byId.get(item.report_id) } : item);
}

function needsTitle(meta: ReportMeta): boolean {
  const title = meta.report_title?.trim() || "";
  return meta.status === "finished" && !!meta.has_report && (
    !/[\u3400-\u9fff]/.test(title) || title === meta.source_name?.trim() || /\.pdf$|…|\.\.\./i.test(title)
    || ["未命名论文", "历史报告", "论文全维度深度透视报告", "论文分析报告", "论文深度分析报告", "论文解析报告", "全维度深度透视报告"].includes(title)
  );
}

export function refreshLegacyTitles(username: string, reports: ReportMeta[]): Promise<Title[]> {
  const entry = entryFor(username);
  if (entry.titlePending) return entry.titlePending;
  const ids = reports.filter(needsTitle).slice(0, 24).map(item => item.report_id);
  if (!ids.length || Date.now() - entry.titleAttemptAt < 300_000) return Promise.resolve([]);
  entry.titleAttemptAt = Date.now();
  // Independent optional request: never delay bootstrap, opening a report, or task completion.
  const request = backendRpc<Title[]>("refresh_report_titles", { username, report_ids: ids }).then(titles => {
    if (entries.get(keyFor(username)) === entry && entry.value) {
      entry.value = { ...entry.value, reports: mergeReportTitles(entry.value.reports, titles) };
    }
    return titles;
  }).catch(() => [] as Title[]).finally(() => {
    if (entry.titlePending === request) entry.titlePending = undefined;
  });
  entry.titlePending = request;
  return request;
}
