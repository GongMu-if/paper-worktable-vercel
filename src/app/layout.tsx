import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "学术文献智能工作台",
  description: "Vercel frontend for paper search and analysis workflow.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
