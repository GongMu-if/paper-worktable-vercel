import { Workbench } from "@/components/Workbench";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "我的工作区 · 学术文献智能工作台" };
export default function Page() { return <Workbench tool="all" />; }
