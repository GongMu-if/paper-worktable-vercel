import { Workbench } from "@/components/Workbench";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "文献检索 · 学术文献智能工作台" };
export default function Page() { return <Workbench tool="search" />; }
