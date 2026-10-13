"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { criarSupabaseBrowser } from "@/lib/supabaseClient";
import type { SupabaseClient } from "@supabase/supabase-js";

type Perfil = { id: string; nome: string | null; papel: string; veiculo: string | null };

export default function MotoristaPage() {
  const router = useRouter();
  const supabaseRef = useRef<SupabaseClient | null>(null);
  if (!supabaseRef.current) supabaseRef.current = criarSupabaseBrowser();
  const supabase = supabaseRef.current;

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [emTurno, setEmTurno] = useState(false);
  const [velocidade, setVelocidade] = useState<number | null>(null);
  const [ultimoEnvio, setUltimoEnvio] = useState<Date | null>(null);
  const [statusGps, setStatusGps] = useState("Aguardando início do turno");
  const [erro, setErro] = useState("");
  const [ultimaMensagem, setUltimaMensagem] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const falandoRef = useRef(false);

  // --- Carrega o perfil / protege a rota ------------------------------------
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }

      const { data } = await supabase
        .from("perfis")
        .select("id, nome, papel, veiculo")
        .eq("id", session.user.id)
        .single();

      if (data) setPerfil(data as Perfil);
    })();
  }, [router, supabase]);

  // --- Fala um texto em voz alta (Text-To-Speech) ---------------------------
  function falar(texto: string, avisoSonoro: boolean) {
    if (!("speechSynthesis" in window)) return;

    const dizer = () => {
      const fala = new SpeechSynthesisUtterance(texto);
      fala.lang = "pt-BR";
      fala.rate = 1;
      fala.pitch = 1;
      fala.volume = 1;
      falandoRef.current = true;
      fala.onend = () => { falandoRef.current = false; };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(fala);
    };

    if (avisoSonoro) {
      tocarBip(() => setTimeout(dizer, 250));
    } else {
      dizer();
    }
  }

  // --- Bip de atenção antes da mensagem (gerado sem arquivo de áudio) -------
  function tocarBip(aoTerminar?: () => void) {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
      osc.onended = () => { ctx.close(); aoTerminar?.(); };
    } catch {
      aoTerminar?.();
    }
  }

  // --- Mantém a tela acesa durante o turno ----------------------------------
  async function manterTelaAcesa() {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
      }
    } catch { /* sem wake lock, segue mesmo assim */ }
  }

  // --- Inicia o turno: GPS + escuta de mensagens ----------------------------
  async function iniciarTurno() {
    setErro("");
    if (!perfil) return;

    if (!("geolocation" in navigator)) {
      setErro("Este aparelho não suporta GPS no navegador.");
      return;
    }

    // "Destrava" a voz no celular com uma fala curta disparada pelo toque.
    if ("speechSynthesis" in window) {
      const aquecer = new SpeechSynthesisUtterance("Turno iniciado.");
      aquecer.lang = "pt-BR";
      window.speechSynthesis.speak(aquecer);
    }

    manterTelaAcesa();
    setEmTurno(true);
    setStatusGps("Obtendo localização…");

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude, longitude, speed, accuracy, heading } = pos.coords;
        // speed vem em m/s → converte para km/h
        const kmh = speed != null && speed >= 0 ? Math.round(speed * 3.6) : null;
        setVelocidade(kmh);
        setStatusGps("Transmitindo localização");

        const { error } = await supabase.from("posicoes").insert({
          motorista_id: perfil.id,
          latitude,
          longitude,
          velocidade: kmh,
          precisao: accuracy ?? null,
          rumo: heading != null && !Number.isNaN(heading) ? heading : null,
        });

        if (!error) setUltimoEnvio(new Date());
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setErro("Permissão de localização negada. Autorize o GPS para o site nas configurações do navegador.");
          pararTurno();
        } else {
          setStatusGps("Sinal de GPS fraco, tentando de novo…");
        }
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
    );

    // Escuta novas mensagens em tempo real e lê em voz alta.
    supabase
      .channel("mensagens-motorista")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "mensagens",
          filter: `destinatario=eq.${perfil.id}`,
        },
        (payload) => {
          const m = payload.new as { id: number; texto: string; aviso_sonoro: boolean };
          setUltimaMensagem(m.texto);
          falar(m.texto, m.aviso_sonoro);
          supabase.from("mensagens").update({ lida: true }).eq("id", m.id).then(() => {});
        }
      )
      .subscribe();
  }

  function pararTurno() {
    setEmTurno(false);
    setStatusGps("Turno encerrado");
    setVelocidade(null);
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (wakeLockRef.current) {
      wakeLockRef.current.release?.();
      wakeLockRef.current = null;
    }
    supabase.removeAllChannels();
  }

  async function sair() {
    pararTurno();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  // Reativa o wake lock quando o app volta ao primeiro plano.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && emTurno) manterTelaAcesa();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [emTurno]);

  if (!perfil) {
    return <main style={{ display: "grid", placeItems: "center", height: "100vh", color: "var(--text-dim)" }}>Carregando…</main>;
  }

  return (
    <main style={{ padding: 20, maxWidth: 480, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <strong>{perfil.nome || "Motorista"}</strong>
          <div style={{ fontSize: 13, color: "var(--text-dim)" }}>{perfil.veiculo || "Veículo não definido"}</div>
        </div>
        <button className="btn-ghost" onClick={sair} style={{ padding: "8px 14px", fontSize: 14 }}>Sair</button>
      </header>

      <div className="card" style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 6 }}>VELOCIDADE ATUAL</div>
        <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1 }}>
          {velocidade != null ? velocidade : "--"}
          <span style={{ fontSize: 20, color: "var(--text-dim)", fontWeight: 500 }}> km/h</span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            width: 10, height: 10, borderRadius: "50%",
            background: emTurno ? "var(--ok)" : "var(--text-dim)",
            boxShadow: emTurno ? "0 0 8px var(--ok)" : "none",
          }} />
          <span style={{ fontSize: 15 }}>{statusGps}</span>
        </div>
        {ultimoEnvio && (
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>
            Última atualização enviada às {ultimoEnvio.toLocaleTimeString("pt-BR")}
          </div>
        )}
      </div>

      {ultimaMensagem && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--accent)" }}>
          <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 700, marginBottom: 6 }}>ÚLTIMO AVISO RECEBIDO</div>
          <div style={{ fontSize: 16 }}>{ultimaMensagem}</div>
          <button
            className="btn-ghost"
            onClick={() => falar(ultimaMensagem, false)}
            style={{ marginTop: 12, fontSize: 14, padding: "8px 14px" }}
          >
            🔊 Ouvir de novo
          </button>
        </div>
      )}

      {erro && <p style={{ color: "var(--danger)", fontSize: 14 }}>{erro}</p>}

      {!emTurno ? (
        <button className="btn-primary" onClick={iniciarTurno} style={{ width: "100%", padding: 16, fontSize: 17 }}>
          ▶ Iniciar turno
        </button>
      ) : (
        <button className="btn-danger" onClick={pararTurno} style={{ width: "100%", padding: 16, fontSize: 17 }}>
          ■ Encerrar turno
        </button>
      )}

      <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 16, textAlign: "center" }}>
        Mantenha esta tela aberta durante o trajeto. Os avisos da central serão lidos em voz alta automaticamente.
      </p>
    </main>
  );
}
