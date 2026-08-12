"use client";

import { useEffect, useState } from "react";
import { loadCareerLabPublicPreview, type CareerLabPublicPreview } from "../services/nexo-career-lab";

const phaseNames: Record<string, string> = { preparation: "Preparando la jornada", locked: "Once bloqueado", played: "Partidos finalizados", adjustment_pending: "Ajuste pendiente", interlude: "Interludio de temporada", completed: "Temporada completada", failed: "Carrera finalizada" };

export function CareerLaboratoryObserver({ token }: { token: string }) {
  const [preview, setPreview] = useState<CareerLabPublicPreview | null>(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const next = await loadCareerLabPublicPreview(token);
        if (active) { setPreview(next); setError(""); setConnected(true); }
      } catch (reason) {
        if (active) {
          const message = reason instanceof Error ? reason.message : "Vista no disponible";
          setConnected(false); setError(message);
          if (message.toLocaleLowerCase("es").includes("no disponible")) setPreview(null);
        }
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [token]);

  if (error && !preview) return <main className="lab-observer-error"><span>LAB</span><h1>Esta vista de prueba ya no está disponible</h1><p>El enlace puede haber caducado o la sesión ha sido eliminada desde Administración.</p></main>;
  if (!preview) return <main className="lab-observer-loading"><span>LAB</span><h1>Conectando con la simulación…</h1></main>;

  const lineup = preview.state.currentLineup;
  const lastReport = preview.state.reports?.[preview.state.reports.length - 1] as Record<string, unknown> | undefined;
  return <main className="lab-observer-shell">
    <header className="lab-observer-warning"><span>SIMULACIÓN</span><p><strong>Vista del usuario · datos de prueba</strong><small>Nada de lo que aparece aquí modifica la cuenta, Carrera o recompensas reales.</small></p><b className={connected ? "online" : ""}>{connected ? "● En directo" : "Reconectando…"}</b></header>
    <section className="lab-observer-hero">
      <div><p className="eyebrow">CARRERA DE MÁNAGER · {preview.session.userName}</p><h1>{preview.session.sportsClubName}</h1><p>Jornada {preview.session.matchday} de {preview.session.maximumMatchday} · {phaseNames[preview.session.phase] ?? preview.session.phase}</p></div>
      <div className="lab-observer-identity"><span>{preview.session.sportsClubName?.split(/\s+/).map((word) => word[0]).slice(0, 2).join("")}</span><small>Confianza</small><strong>{preview.state.confidence}<i>/100</i></strong></div>
    </section>
    <section className="lab-observer-kpis"><article><small>Reputación</small><strong>{preview.state.reputation}/100</strong></article><article><small>Puntos acumulados</small><strong>{preview.state.sportingPoints}</strong></article><article><small>Presupuesto</small><strong>{Number(preview.state.budget).toFixed(1)} M</strong></article><article><small>Racha de fallos</small><strong>{preview.state.consecutiveFailures}</strong></article></section>
    {preview.state.activeInterlude && <section className="lab-observer-notice purple"><span>◷</span><p><strong>{String(preview.state.activeInterlude.title ?? "Interludio de temporada")}</strong><small>La dirección deportiva debe elegir cómo aprovechar este descanso.</small></p></section>}
    {!!preview.state.incidents?.length && <section className="lab-observer-notice"><span>!</span><p><strong>{preview.state.incidents.length} incidencia de plantilla</strong><small>La simulación está comprobando cómo afecta a la Carrera.</small></p></section>}
    <section className="lab-observer-lineup">
      <header><div><p className="eyebrow">MI ONCE · JORNADA {preview.session.matchday}</p><h2>{lineup ? lineup.formation : "Aún sin preparar"}</h2></div>{lineup?.locked && <span>ONCE BLOQUEADO</span>}</header>
      {lineup?.players?.length ? <div>{lineup.players.map((player) => <article key={player.id} className={player.id === lineup.captainId ? "captain" : ""}><span>{player.initials}{player.id === lineup.captainId && <b>C</b>}</span><p><strong>{player.name}</strong><small>{player.position} · {player.club}</small></p>{typeof player.points === "number" && <em>{player.points} pts</em>}</article>)}</div> : <div className="lab-observer-empty"><b>XI</b><p><strong>El mánager todavía no ha preparado su equipo</strong><small>Cuando Administración avance la simulación, el once aparecerá aquí automáticamente.</small></p></div>}
    </section>
    {lastReport && <section className="lab-observer-last-report"><span>J{String(lastReport.matchday ?? "")}</span><p><small>ÚLTIMO CIERRE</small><strong>{String(lastReport.points ?? 0)} puntos</strong></p><b>{lastReport.missionPassed ? "Objetivo cumplido" : "Objetivo fallado"}</b></section>}
    <footer>Última actualización: {new Date(preview.session.updatedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · actualización automática cada 2 segundos</footer>
  </main>;
}
