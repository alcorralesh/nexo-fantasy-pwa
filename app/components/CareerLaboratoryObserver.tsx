"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { actCareerLabPublic, loadCareerLabPublicPreview, type CareerLabDecisionChoice, type CareerLabObjective, type CareerLabPublicPreview } from "../services/nexo-career-lab";

const phaseNames: Record<string, string> = { preparation: "Preparando la jornada", locked: "Once bloqueado", played: "Partidos finalizados", adjustment_pending: "Ajuste pendiente", interlude: "Interludio de temporada", completed: "Temporada completada", failed: "Carrera finalizada" };
const statusNames: Record<string, string> = { active: "En curso", completed: "Cumplido", failed: "Fallado" };

function delta(value: number, suffix = "") { return `${value > 0 ? "+" : ""}${value}${suffix}`; }
function progress(objective?: CareerLabObjective) { return objective ? Math.max(0, Math.min(100, Math.round(objective.currentValue / Math.max(1, objective.targetValue) * 100))) : 0; }

export function CareerLaboratoryObserver({ token }: { token: string }) {
  const [preview, setPreview] = useState<CareerLabPublicPreview | null>(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(true);
  const [area, setArea] = useState<"overview" | "lineup" | "market">("overview");
  const [pendingChoice, setPendingChoice] = useState<CareerLabDecisionChoice | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try { const next = await loadCareerLabPublicPreview(token); setPreview(next); setError(""); setConnected(true); }
    catch (reason) { const message = reason instanceof Error ? reason.message : "Vista no disponible"; setConnected(false); setError(message); if (message.toLocaleLowerCase("es").includes("no disponible")) setPreview(null); }
  }, [token]);

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 2000); return () => window.clearInterval(timer); }, [refresh]);

  async function act(action: "decision" | "prepare_lineup" | "lock_lineup" | "interlude" | "incident", payload: Record<string, unknown> = {}) {
    setBusy(true); setError("");
    try { const next = await actCareerLabPublic(token, action, payload); setPreview(next); setPendingChoice(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo completar la acción"); }
    finally { setBusy(false); }
  }

  const chosenDecision = useMemo(() => preview?.state.decisions?.find((item) => Number(item.matchday) === preview.session.matchday), [preview]);
  if (error && !preview) return <main className="lab-observer-error"><span>LAB</span><h1>Esta vista de prueba ya no está disponible</h1><p>El enlace puede haber caducado o la sesión ha sido eliminada desde Administración.</p></main>;
  if (!preview) return <main className="lab-observer-loading"><span>LAB</span><h1>Conectando con la simulación…</h1></main>;

  const lineup = preview.state.currentLineup;
  const objectives = preview.state.objectives ?? [];
  const seasonObjective = objectives.find((item) => item.type === "season");
  const currentObjectives = objectives.filter((item) => item.type !== "matchday" || item.expiresMatchday === preview.session.matchday);
  const initials = preview.session.sportsClubName?.split(/\s+/).map((word) => word[0]).slice(0, 2).join("");

  return <main className="lab-observer-shell manager-career-page">
    <header className="lab-observer-warning"><span>SIMULACIÓN</span><p><strong>Modo Carrera real dentro del laboratorio</strong><small>Tus decisiones se guardan solo en esta copia de prueba; no afectan a la cuenta ni a las recompensas reales.</small></p><b className={connected ? "online" : ""}>{connected ? "● En directo" : "Reconectando…"}</b></header>
    <div className="career-topline"><button type="button" disabled>← Laboratorio</button><p><span>CARRERA DE MÁNAGER · J{preview.session.matchday}</span><strong>{preview.session.sportsClubName} · 26/27</strong></p><button type="button" onClick={() => void refresh()}>Actualizar</button></div>
    <nav className="career-lab-tabs" aria-label="Secciones de Carrera"><button className={area === "overview" ? "active" : ""} onClick={() => setArea("overview")}>Resumen</button><button className={area === "lineup" ? "active" : ""} onClick={() => setArea("lineup")}>Mi once</button><button className={area === "market" ? "active" : ""} onClick={() => setArea("market")}>Mercado</button></nav>
    {!!error && <div className="lab-action-error">{error}</div>}

    {area === "overview" && <>
      <section className="career-hero"><div><p className="eyebrow">{phaseNames[preview.session.phase] ?? preview.session.phase}</p><h1>Que el club recuerde tu nombre.</h1><p>Prepara el once, responde a la directiva y cumple tus objetivos. Administración controla el calendario; tú tomas las decisiones del mánager.</p><div><button type="button" onClick={() => setArea("lineup")}>Preparar el once →</button><button type="button" onClick={() => setArea("market")}>Abrir mercado</button></div></div><section><span>{initials}</span><p><small>CONFIANZA DE LA DIRECTIVA</small><strong>{preview.state.confidence}<i>/100</i></strong></p><div><i style={{ width: `${preview.state.confidence}%` }} /></div></section></section>
      <section className="career-kpis"><article><small>PRESUPUESTO</small><strong>{Number(preview.state.budget).toFixed(1)} M</strong><span>Saldo de esta simulación</span></article><article><small>REPUTACIÓN</small><strong>{preview.state.reputation}/100</strong><span>Tu huella como mánager</span></article><article><small>PUNTOS DEPORTIVOS</small><strong>{preview.state.sportingPoints}</strong><span>Acumulados en la temporada</span></article><article><small>RIESGO</small><strong>{preview.state.consecutiveFailures}/3</strong><span>Fallos consecutivos</span></article></section>
      <div className="career-main-grid">
        <article className="career-objectives"><p className="eyebrow">CONTRATO DE LA DIRECTIVA</p><h2>Objetivos que importan</h2>{seasonObjective && <div className="career-objective-main"><span>{progress(seasonObjective)}%</span><p><strong>{seasonObjective.title}</strong><small>{seasonObjective.currentValue} de {seasonObjective.targetValue} puntos · {seasonObjective.description}</small><i><b style={{ width: `${progress(seasonObjective)}%` }} /></i></p></div>}<ul>{currentObjectives.filter((item) => item.id !== seasonObjective?.id).map((objective) => <li className={objective.status} key={objective.id}><span>{objective.status === "completed" ? "✓" : objective.status === "failed" ? "×" : progress(objective) + "%"}</span><p><strong>{objective.title}</strong><small>{objective.description} · {objective.currentValue}/{objective.targetValue}</small></p><b>{statusNames[objective.status]} · {objective.status === "active" ? `+${objective.reputationReward} REP` : objective.status === "failed" ? `-${objective.failurePenalty} confianza` : `+${objective.reputationReward} REP`}</b></li>)}</ul></article>
        <article className="career-decision"><p className="eyebrow">DECISIÓN DE LA JORNADA</p><h2>{preview.state.decisionPrompt?.title ?? "Sin dilema pendiente"}</h2><p>{preview.state.decisionPrompt?.description ?? "La directiva no ha planteado una decisión para esta jornada."}</p>
          {chosenDecision ? <div className="career-decision-result"><span>✓</span><strong>{String(chosenDecision.choiceTitle)}</strong><small>{String(chosenDecision.consequence)}</small></div> : preview.session.phase !== "preparation" ? <div className="career-decision-result"><span>—</span><strong>Decisión cerrada</strong><small>La jornada ya está bloqueada.</small></div> : <div className="career-decision-options">{preview.state.decisionPrompt?.choices.map((choice) => <button disabled={busy} key={choice.key} onClick={() => setPendingChoice(choice)}><strong>{choice.title}</strong><small>{choice.summary}</small><span className="career-choice-timing"><i><b>OCURRE AHORA</b>{delta(choice.confidenceChange, " confianza")} · {delta(choice.reputationChange, " REP")} · {delta(choice.budgetChange, " M")}</i><i><b>AL CERRAR</b>{choice.condition ? `${choice.condition}: +${choice.conditionalBonus ?? 0} pts` : `${delta(choice.sportingPointsChange, " pts")}`}</i></span><em>Ver y confirmar →</em></button>)}</div>}
          <footer>Las decisiones se cierran al bloquear la jornada y sus consecuencias aparecen en el siguiente informe.</footer>
        </article>
      </div>
      {preview.session.phase === "interlude" && preview.state.activeInterlude && <section className="career-lab-action-card purple"><p className="eyebrow">INTERLUDIO</p><h2>{String(preview.state.activeInterlude.title ?? "Tiempo para reconstruir")}</h2><p>Elige cómo aprovechar el descanso. La jornada no avanzará hasta que decidas.</p><div><button disabled={busy} onClick={() => void act("interlude", { strategy: "recovery" })}><b>Recuperar al grupo</b><small>+5 confianza y reduce un fallo</small></button><button disabled={busy} onClick={() => void act("interlude", { strategy: "academy" })}><b>Trabajo de cantera</b><small>+4 reputación</small></button><button disabled={busy} onClick={() => void act("interlude", { strategy: "commercial" })}><b>Gira comercial</b><small>+1,5 M y −3 confianza</small></button><button disabled={busy} onClick={() => void act("interlude", { strategy: "tactical" })}><b>Laboratorio táctico</b><small>Protección para la próxima jornada</small></button></div></section>}
      {(preview.state.incidents ?? []).filter((item) => item.status === "pending").map((incident) => <section className="career-lab-action-card" key={String(incident.id)}><p className="eyebrow">INCIDENCIA DE PLANTILLA</p><h2>{String(incident.title ?? "Un jugador abandona el proyecto")}</h2><p>Elige entre recuperar todo el valor o proteger la identidad del club.</p><div><button disabled={busy} onClick={() => void act("incident", { incidentId: incident.id, choice: "reinvest" })}><b>Reinvertir todo</b><small>Recuperas el 100% · −2 confianza</small></button><button disabled={busy} onClick={() => void act("incident", { incidentId: incident.id, choice: "identity" })}><b>Proteger la identidad</b><small>Recuperas el 85% · +3 reputación</small></button></div></section>)}
    </>}

    {area === "lineup" && <section className="lab-observer-lineup career-lab-lineup"><header><div><p className="eyebrow">MI ONCE · JORNADA {preview.session.matchday}</p><h2>{lineup ? lineup.formation : "Aún sin preparar"}</h2></div>{lineup?.locked ? <span>ONCE BLOQUEADO</span> : preview.session.phase === "preparation" && <div className="career-lab-lineup-actions"><button disabled={busy} onClick={() => void act("prepare_lineup")}>{lineup ? "Rehacer once" : "Preparar once"}</button>{lineup?.valid && <button disabled={busy} onClick={() => void act("lock_lineup")}>Confirmar once</button>}</div>}</header>{lineup?.players?.length ? <div>{lineup.players.map((player) => <article key={player.id} className={player.id === lineup.captainId ? "captain" : ""}><span>{player.initials}{player.id === lineup.captainId && <b>C</b>}</span><p><strong>{player.name}</strong><small>{player.position} · {player.club}{player.original ? " · Original" : ""}</small></p>{typeof player.points === "number" && <em>{player.points} pts</em>}</article>)}</div> : <div className="lab-observer-empty"><b>XI</b><p><strong>Prepara el equipo de esta jornada</strong><small>Se generará con las mismas reglas de plantilla y posiciones del laboratorio.</small></p></div>}</section>}

    {area === "market" && <section className="career-lab-market"><header><p className="eyebrow">MERCADO INDIVIDUAL</p><h2>Tu plantilla de Carrera</h2><p>Esta vista reproduce el estado deportivo de la copia. Las altas y bajas inyectadas desde Administración aparecerán aquí.</p></header><div>{preview.state.squad.map((player) => <article className={!player.active ? "inactive" : ""} key={player.id}><span>{player.initials}</span><p><strong>{player.name}</strong><small>{player.position} · {player.club}</small></p><b>{Number(player.value).toFixed(1)} M</b><em>{!player.active ? "Fuera de competición" : player.original ? "Original" : "Fichaje"}</em></article>)}</div></section>}

    {pendingChoice && <div className="career-lab-confirm-backdrop" role="presentation"><section role="dialog" aria-modal="true" aria-label="Confirmar decisión"><button className="close" onClick={() => setPendingChoice(null)}>×</button><p className="eyebrow">ANTES DE DECIDIR</p><h2>{pendingChoice.title}</h2><p>{pendingChoice.summary}</p><div><article><small>OCURRE AHORA</small><strong>{delta(pendingChoice.confidenceChange, " confianza")}</strong><span>{delta(pendingChoice.reputationChange, " reputación")} · {delta(pendingChoice.budgetChange, " M")}</span></article><article><small>AL CERRAR LA JORNADA</small><strong>{pendingChoice.condition ?? "Efecto garantizado"}</strong><span>{pendingChoice.condition ? `Si cumples: +${pendingChoice.conditionalBonus ?? 0} puntos` : delta(pendingChoice.sportingPointsChange, " puntos")}</span></article></div><footer><button disabled={busy} onClick={() => setPendingChoice(null)}>Volver</button><button disabled={busy} onClick={() => void act("decision", { choiceKey: pendingChoice.key })}>{busy ? "Guardando…" : "Confirmar decisión"}</button></footer></section></div>}
    <footer className="lab-observer-footer">Última actualización: {new Date(preview.session.updatedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · actualización automática cada 2 segundos</footer>
  </main>;
}
