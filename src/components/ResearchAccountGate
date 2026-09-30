"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ResearchNav } from "./ResearchNav";
import { LoginCard } from "./ResearchLoginCard";
import {
  readResearchUsername, writeResearchUsername,
  RESEARCH_ACCOUNT_KEY, RESEARCH_ACCOUNT_EVENT,
} from "@/lib/researchAccount";

export function ResearchAccountGate({ active, children }: {
  active: "search" | "reading" | "workspace" | "introduction";
  children: (username: string, logout: () => void) => ReactNode;
}) {
  const [username, setUsername] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => { setUsername(readResearchUsername()); setReady(true); };
    const onStorage = (event: StorageEvent) => {
      if (event.key === RESEARCH_ACCOUNT_KEY || event.key === null) sync();
    };
    sync();
    window.addEventListener("storage", onStorage);
    window.addEventListener(RESEARCH_ACCOUNT_EVENT, sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(RESEARCH_ACCOUNT_EVENT, sync);
    };
  }, []);

  // Callers key their business component by username, preventing account
  // switches from retaining the previous account's reports, files or polling.
  if (ready && username) return children(username, () => writeResearchUsername(""));
  return (
    <div className="business-login">
      <ResearchNav active={active} />
      {ready ? <LoginCard onLogin={writeResearchUsername} /> : <p role="status">正在读取登录状态…</p>}
    </div>
  );
}
