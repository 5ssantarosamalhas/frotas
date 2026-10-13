"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { criarSupabaseBrowser } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setCarregando(true);

    const supabase = criarSupabaseBrowser();
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

    setCarregando(false);
    if (error) {
      setErro("E-mail ou senha incorretos.");
      return;
    }
    router.replace("/");
  }

  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 20 }}>
      <form onSubmit={entrar} className="card" style={{ width: "100%", maxWidth: 380 }}>
        <h1 style={{ marginTop: 0, fontSize: 22 }}>Rastreador de Frota</h1>
        <p style={{ color: "var(--text-dim)", marginTop: -6, fontSize: 14 }}>
          Entre com seu acesso da empresa.
        </p>

        <div style={{ marginBottom: 14 }}>
          <label>E-mail</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>

        <div style={{ marginBottom: 18 }}>
          <label>Senha</label>
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {erro && (
          <p style={{ color: "var(--danger)", fontSize: 14, marginTop: 0 }}>{erro}</p>
        )}

        <button type="submit" className="btn-primary" style={{ width: "100%" }} disabled={carregando}>
          {carregando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
