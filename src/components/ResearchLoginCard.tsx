"use client";

import { useState } from "react";
import { authenticateUser, ensureAppStorage, registerUser } from "@/lib/api";

type AuthMode = "login" | "register";

export function LoginCard({ onLogin }: { onLogin: (username: string) => void }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError("");
    setBusy(true);
    try {
      await ensureAppStorage();
      if (mode === "register") {
        if (password !== confirm) {
          setError("两次输入的密码不一致。");
          return;
        }
        const result = await registerUser(username, password);
        if (!result.ok) {
          setError(result.result);
          return;
        }
        onLogin(result.result);
      } else {
        const result = await authenticateUser(username, password);
        if (!result.ok) {
          setError(result.result);
          return;
        }
        onLogin(result.result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card stack">
        <div>
          <div className="auth-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><rect x="8" y="4" width="18" height="23" rx="3" stroke="currentColor" strokeWidth="1.6" /><path d="M5 9v16a5 5 0 0 0 5 5M13 11h8M13 16h8M13 21h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></div>
          <h1>学术文献智能工作台</h1>
          <p className="muted">请登录研究工作区。系统会为每个账号独立保存文献检索记录与论文精读报告。</p>
        </div>
        <div className="tabs">
          <button className={`tab ${mode === "login" ? "active" : ""}`} onClick={() => setMode("login")}>登录</button>
          <button className={`tab ${mode === "register" ? "active" : ""}`} onClick={() => setMode("register")}>注册</button>
        </div>
        <div className="stack-sm">
          <label className="small">账号</label>
          <input className="input" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入账号" />
        </div>
        <div className="stack-sm">
          <label className="small">密码</label>
          <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" />
        </div>
        {mode === "register" ? (
          <div className="stack-sm">
            <label className="small">确认密码</label>
            <input className="input" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="请再次输入密码" />
          </div>
        ) : null}
        {error ? <div className="notice error">{error}</div> : null}
        <button className="button full" disabled={busy || !username || !password} onClick={submit}>
          {busy ? "处理中..." : mode === "register" ? "注册并进入系统" : "登录"}
        </button>
      </div>
    </div>
  );
}
