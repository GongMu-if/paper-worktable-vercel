import { Workbench } from "@/components/Workbench";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "论文精读 · 学术文献智能工作台" };
export default function Page() { return <Workbench tool="reading" />; }
