"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { criarSupabaseBrowser } from "@/lib/supabaseClient";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VeiculoNoMapa } from "@/components/Mapa";

// O mapa só roda no navegador (Leaflet usa window), por isso o import dinâmico.
const Mapa = dynamic(() => import("@/components/Mapa"), {
  ssr: false,
  loading: () => <div style={{ height: "100%", display: "grid", placeItems: "center", color: "var(--text-dim)" }}>Carregando mapa…</div>,
});

type Motorista = { id: string; nome: string | null; veiculo: string | null };

export default function PainelPage() {
  const router = useRouter();
  const supabaseRef = useRef<SupabaseClient | null>(null);
  if (!supabaseRef.current) supabaseRef.current = criarSupabaseBrowser();
  const supabase = supabaseRef.current;

  const [autorizado, setAutorizado] = useState(false);
  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [posicoes, setPosicoes] = useState<Record<string, VeiculoNoMapa>>({});
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const [texto, setTexto] = useState("");
  const [avisoSonoro, setAvisoSonoro] = useState(true);
  const [destino, setDestino] = useState<string>("");
  const [enviando, setEnviando] = useState(false);
  const [feedback, setFeedback] = useState("");

  // --- Proteção da rota: só gestor entra ------------------------------------
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }

      const { data: perfil } = await supabase
        .from("perfis").select("papel").eq("id", session.user.id).single();

      if (perfil?.papel !== "gestor") { router.replace("/motorista"); return; }
      setAutorizado(true);

      // Carrega a lista de motoristas.
      const { data: lista } = await supabase
        .from("perfis").select("id, nome, veiculo").eq("papel", "motorista");
      if (lista) setMotoristas(lista as Motorista[]);

      // Carrega a última posição conhecida de cada motorista.
      const { data: ultimas } = await supabase
        .from("posicoes")
        .select("motorista_id, latitude, longitude, velocidade, criado_em")
        .order("criado_em", { ascending: false })
        .limit(500);

      if (ultimas && lista) {
        const vistos: Record<string, VeiculoNoMapa> = {};
        for (const p of ultimas as any[]) {
          if (vistos[p.motorista_id]) continue; // já peguei a mais recente
          const m = (lista as Motorista[]).find((x) => x.id === p.motorista_id);
          if (!m) continue;
          vistos[p.motorista_id] = {
            id: p.motorista_id,
            nome: m.nome || "Motorista",
            veiculo: m.veiculo,
            latitude: p.latitude,
            longitude: p.longitude,
            velocidade: p.velocidade,
            atualizadoEm: p.criado_em,
          };
        }
        setPosicoes(vistos);
      }
    })();
  }, [router, supabase]);

  // --- Tempo real: cada nova posição atualiza o pino no mapa ----------------
  useEffect(() => {
    if (!autorizado || motoristas.length === 0) return;

    const canal = supabase
      .channel("posicoes-painel")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posicoes" },
        (payload) => {
          const p = payload.new as any;
          const m = motoristas.find((x) => x.id === p.motorista_id);
          if (!m) return;
          setPosicoes((prev) => ({
            ...prev,
            [p.motorista_id]: {
              id: p.motorista_id,
              nome: m.nome || "Motorista",
              veiculo: m.veiculo,
              latitude: p.latitude,
              longitude: p.longitude,
              velocidade: p.velocidade,
              atualizadoEm: p.criado_em,
            },
          }));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(canal); };
  }, [autorizado, motoristas, supabase]);

  async function enviarMensagem(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim() || !destino) return;
    setEnviando(true);
    setFeedback("");

    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase.from("mensagens").insert({
      destinatario: destino,
      remetente: session?.user.id,
      texto: texto.trim(),
      aviso_sonoro: avisoSonoro,
    });

    setEnviando(false);
    if (error) {
      setFeedback("Erro ao enviar. Tente de novo.");
    } else {
      setFeedback("✓ Aviso enviado — será lido no celular do motorista.");
      setTexto("");
      setTimeout(() => setFeedback(""), 4000);
    }
  }

  async function sair() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (!autorizado) {
    return <main style={{ display: "grid", placeItems: "center", height: "100vh", color: "var(--text-dim)" }}>Verificando acesso…</main>;
  }

  const listaVeiculos = Object.values(posicoes);

  function tempoDesde(iso: string) {
    const seg = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (seg < 60) return `${seg}s atrás`;
    if (seg < 3600) return `${Math.round(seg / 60)}min atrás`;
    return `${Math.round(seg / 3600)}h atrás`;
  }

  return (
    <div style={{ display: "flex", height: "100vh", flexDirection: "column" }}>
      <header style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "12px 20px", borderBottom: "1px solid var(--border)", background: "var(--surface)",
      }}>
        <strong style={{ fontSize: 18 }}>Central de Frota</strong>
        <button className="btn-ghost" onClick={sair} style={{ padding: "8px 14px", fontSize: 14 }}>Sair</button>
      </header>

      <div style={{ display: "flex", flex: 1, overflow: "hidden", flexWrap: "wrap" }}>
        {/* MAPA */}
        <div style={{ flex: "1 1 420px", minHeight: 300, position: "relative" }}>
          <Mapa veiculos={listaVeiculos} selecionado={selecionado} />
        </div>

        {/* PAINEL LATERAL */}
        <aside style={{
          flex: "0 0 340px", maxWidth: "100%", borderLeft: "1px solid var(--border)",
          background: "var(--surface)", overflowY: "auto", padding: 16,
        }}>
          <h3 style={{ marginTop: 0, fontSize: 15, color: "var(--text-dim)" }}>
            VEÍCULOS ({listaVeiculos.length})
          </h3>

          {listaVeiculos.length === 0 && (
            <p style={{ fontSize: 14, color: "var(--text-dim)" }}>
              Nenhum veículo transmitindo ainda. Peça ao motorista para abrir o app e iniciar o turno.
            </p>
          )}

          {listaVeiculos.map((v) => {
            const emMovimento = v.velocidade != null && v.velocidade > 3;
            return (
              <div
                key={v.id}
                onClick={() => setSelecionado(selecionado === v.id ? null : v.id)}
                className="card"
                style={{
                  padding: 12, marginBottom: 10, cursor: "pointer",
                  borderColor: selecionado === v.id ? "var(--accent)" : "var(--border)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: 15 }}>{v.veiculo || v.nome}</strong>
                  <span style={{
                    fontSize: 12, fontWeight: 700,
                    color: emMovimento ? "var(--ok)" : "var(--warn)",
                  }}>
                    {emMovimento ? `${v.velocidade} km/h` : "Parado"}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
                  {v.nome} · {tempoDesde(v.atualizadoEm)}
                </div>
              </div>
            );
          })}

          {/* ENVIO DE AVISO FALADO */}
          <h3 style={{ fontSize: 15, color: "var(--text-dim)", marginTop: 24 }}>ENVIAR AVISO FALADO</h3>
          <form onSubmit={enviarMensagem}>
            <div style={{ marginBottom: 10 }}>
              <label>Para qual motorista</label>
              <select value={destino} onChange={(e) => setDestino(e.target.value)} required>
                <option value="">Selecione…</option>
                {motoristas.map((m) => (
                  <option key={m.id} value={m.id}>{m.veiculo || m.nome || m.id}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label>Mensagem (será lida em voz alta)</label>
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={3}
                placeholder="Ex.: Retorne à base após a próxima entrega."
                required
              />
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 12, color: "var(--text)" }}>
              <input
                type="checkbox"
                checked={avisoSonoro}
                onChange={(e) => setAvisoSonoro(e.target.checked)}
                style={{ width: "auto" }}
              />
              Tocar bip de atenção antes
            </label>

            <button type="submit" className="btn-primary" style={{ width: "100%" }} disabled={enviando}>
              {enviando ? "Enviando…" : "Enviar aviso"}
            </button>

            {feedback && (
              <p style={{ fontSize: 13, marginTop: 10, color: feedback.startsWith("✓") ? "var(--ok)" : "var(--danger)" }}>
                {feedback}
              </p>
            )}
          </form>
        </aside>
      </div>
    </div>
  );
}
