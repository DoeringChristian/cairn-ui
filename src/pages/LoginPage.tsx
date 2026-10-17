import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { createFragmentLogin } from "../lib/fragment-login";
export default function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fragmentLogin = useRef(createFragmentLogin());
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const pending = fragmentLogin.current(window.location, window.history, api.login);
    if (pending) {
      setBusy(true);
      setError("");
      void pending.then(() => {
        if (!active) return;
        void queryClient.invalidateQueries({ queryKey: qk.session() });
        navigate("/", { replace: true });
      }, () => {
        if (active) setError("Could not sign in with this link. Check the server token and connection, or paste the token below.");
      }).finally(() => { if (active) setBusy(false); });
    }
    return () => { active = false; };
  }, [navigate, queryClient]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      await api.login(token.trim());
      setToken("");
      void queryClient.invalidateQueries({ queryKey: qk.session() });
      navigate("/", { replace: true });
    }
    catch { setError("Could not sign in. Check the server token and connection."); }
    finally { setBusy(false); }
  }
  return <LoginShell><h1 className="text-2xl mb-3">Open your workspace</h1>
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label htmlFor="token">Server token</label>
      <input id="token" type="password" className="input" autoFocus autoComplete="off"
             value={token} onChange={e => setToken(e.target.value)} />
      {error && <p role="alert">{error}</p>}
      <button className="btn justify-center" disabled={busy || !token.trim()}>{busy ? "Signing in…" : "Sign in"}</button>
    </form><p className="text-sm text-fg-muted mt-4">Use the token supplied by your server's owner.</p>
  </LoginShell>;
}

function LoginShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-2">
          <Logo />
          <span className="text-lg font-semibold tracking-tight">Cairn</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect width="24" height="24" rx="5" fill="var(--accent)" />
      <path
        d="M6 17h12M7.5 13h9M9 9h6M10.5 5.5h3"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
