"use client";

import { useEffect, useMemo, useState } from "react";
import { createCareerLab, deleteCareerLab, loadCareerLabCalendar, loadCareerLabOptions, loadCareerLabSessions, loadCareerLabState, restoreCareerLabCheckpoint, runCareerLab, scheduleCareerLabEvent, stepCareerLab, updateCareerLabCalendar, type CareerLabCalendarRound, type CareerLabMode, type CareerLabOptions, type CareerLabProfile, type CareerLabState } from "../../services/nexo-career-lab";

const competitionNames: Record<string, string> = { primera: "Primera", segunda: "Segunda", liga_f: "Liga F" };
const phaseNames: Record<string, string> = { preparation: "Preparación", locked: "Once bloqueado", played: "Partidos jugados", adjustment_pending: "Ajuste pendiente", interlude: "Interludio", completed: "Temporada completada", failed: "Destituido" };
const eventNames: Record<string, string> = { player_exit: "Jugador sale de la competición", player_team_change: "Jugador cambia de equipo", player_new: "Nuevo jugador", player_correction: "Corrección de ficha", fixture_postponed: "Partido aplazado", fixture_advanced: "Partido adelantado", overlapping_matchdays: "Dos jornadas coinciden", interlude: "Interludio forzado" };

function CareerLabCalendarRow({ round, busy, localDate, onSave }: { round: CareerLabCalendarRound; busy: boolean; localDate: (value: string) => string; onSave: (round: CareerLabCalendarRound, startAt: string, endAt: string) => Promise<void> }) {
  const [startAt, setStartAt] = useState(localDate(round.startAt));
  const [endAt, setEndAt] = useState(localDate(round.endAt));
  useEffect(() => { setStartAt(localDate(round.startAt)); setEndAt(localDate(round.endAt)); }, [round.startAt, round.endAt]);
  return <article className={round.interludeDetected ? "interlude" : round.edited ? "edited" : ""}><b>J{round.matchday}</b><label>Inicio<input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} /></label><label>Final<input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} /></label><p>{round.interludeDetected ? <><strong>Interludio automático</strong><small>{round.gapBeforeDays} días desde la jornada anterior</small></> : round.edited ? <><strong>Fecha modificada</strong><small>Solo en esta simulación</small></> : <><strong>Calendario original</strong><small>Sin cambios</small></>}</p><button disabled={busy || !startAt || !endAt} onClick={() => void onSave(round, startAt, endAt)}>Guardar</button></article>;
}

export function CareerLaboratoryAdmin({ enabled, notify }: { enabled: boolean; notify: (message: string) => void }) {
  const [options, setOptions] = useState<CareerLabOptions>({ users: [], careers: [], teams: [] });
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof loadCareerLabSessions>>>([]);
  const [lab, setLab] = useState<CareerLabState | null>(null);
  const [tab, setTab] = useState<"control" | "calendar" | "events" | "report" | "preview">("control");
  const [calendar, setCalendar] = useState<CareerLabCalendarRound[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ userId: "", sourceCareerId: "", competitionId: "primera", sportsClubId: "", difficulty: "balanced", profile: "competitive" as CareerLabProfile, mode: "guided" as CareerLabMode, seed: "nexo-temporada-1", title: "" });
  const [event, setEvent] = useState({ matchday: 1, moment: "before_preparation", type: "player_exit", title: "Incidencia de prueba", playerId: "", newClub: "", days: 14 });

  async function refresh(selectedId?: string) {
    if (!enabled) return;
    const [nextOptions, nextSessions] = await Promise.all([loadCareerLabOptions(), loadCareerLabSessions()]);
    setOptions(nextOptions); setSessions(nextSessions);
    const id = selectedId ?? lab?.session.id;
    if (id) { const [nextLab, nextCalendar] = await Promise.all([loadCareerLabState(id), loadCareerLabCalendar(id)]); setLab(nextLab); setCalendar(nextCalendar); }
  }

  useEffect(() => { void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "No se pudo abrir el laboratorio")); }, [enabled]);
  useEffect(() => {
    const firstUser = options.users[0]?.id ?? "";
    const teams = options.teams.filter((team) => team.competitionId === form.competitionId);
    setForm((current) => ({ ...current, userId: current.userId || firstUser, sportsClubId: teams.some((team) => team.id === current.sportsClubId) ? current.sportsClubId : teams[0]?.id ?? "" }));
  }, [options, form.competitionId]);

  const availableCareers = options.careers.filter((career) => career.userId === form.userId);
  const availableTeams = options.teams.filter((team) => team.competitionId === form.competitionId);
  const failedChecks = lab?.lastReport?.checks?.filter((check) => !check.passed) ?? [];
  const nextAction = lab?.session.phase === "preparation" ? (lab.state.currentLineup ? "lock" : "prepare") : lab?.session.phase === "locked" ? "play" : lab?.session.phase === "played" ? "close" : lab?.session.phase === "adjustment_pending" ? "adjust" : "";
  const nextActionLabel: Record<string, string> = { prepare: "Preparar once", lock: "Bloquear jornada", play: "Simular partidos", close: "Cerrar jornada", adjust: "Aplicar ajuste", advance_interlude_day: "Avanzar al día siguiente" };
  const activeInterlude=lab?.state.activeInterlude;
  const interludeDay=Number(activeInterlude?.currentDay??1);
  const interludeActivityDays=Number(activeInterlude?.activityDays??1);
  const interludeActions=Array.isArray(activeInterlude?.actions)?activeInterlude.actions as Array<Record<string,unknown>>:[];
  const interludeActionToday=interludeActions.find((item)=>Number(item.day)===interludeDay);

  async function execute(action: () => Promise<CareerLabState | void>, message: string) {
    setBusy(true); setError("");
    try {
      const result = await action();
      if (result) { setLab(result); await refresh(result.session.id); }
      else {
        const [nextOptions, nextSessions] = await Promise.all([loadCareerLabOptions(), loadCareerLabSessions()]);
        setOptions(nextOptions); setSessions(nextSessions);
      }
      notify(message);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "La operación no se pudo completar"); }
    finally { setBusy(false); }
  }

  async function createSession() {
    setBusy(true); setError("");
    try {
      const id = await createCareerLab(form); await refresh(id); notify("Laboratorio aislado creado");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo crear la sesión"); }
    finally { setBusy(false); }
  }

  async function addEvent() {
    if (!lab) return;
    const player = lab.state.squad.find((item) => item.id === event.playerId);
    const payload: Record<string, unknown> = { playerId: event.playerId, playerName: player?.name, newClub: event.newClub, days: event.days, value: player?.value, strategy: "recovery" };
    setBusy(true);
    try { await scheduleCareerLabEvent(lab.session.id, { matchday: event.matchday, moment: event.moment, type: event.type, title: event.title, payload }); await refresh(lab.session.id); notify("Evento añadido a la línea temporal"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo programar el evento"); }
    finally { setBusy(false); }
  }

  async function saveRound(round: CareerLabCalendarRound, startAt: string, endAt: string) {
    if (!lab) return;
    await execute(() => updateCareerLabCalendar(lab.session.id, round.matchday, new Date(startAt).toISOString(), new Date(endAt).toISOString()), `Calendario de J${round.matchday} actualizado`);
    setCalendar(await loadCareerLabCalendar(lab.session.id));
  }

  function localDate(value: string) { const date = new Date(value); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 16); }

  function observerUrl() {
    if (!lab?.session.previewToken || typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    url.search = ""; url.hash = "";
    url.searchParams.set("careerLab", lab.session.previewToken);
    return url.toString();
  }

  async function copyObserverLink() {
    const url = observerUrl();
    if (!url) return;
    await navigator.clipboard.writeText(url);
    notify("Enlace de observación copiado");
  }

  if (!enabled) return <section className="career-lab-disabled"><span>LAB</span><div><h2>Laboratorio de Carrera</h2><p>Inicia sesión como administrador para usar este entorno de pruebas.</p></div></section>;

  if (!lab) return (
    <section className="career-lab-page">
      <header className="career-lab-hero"><div><p className="eyebrow">ENTORNO AISLADO · SOLO ADMINISTRACIÓN</p><h2>Laboratorio de Carrera</h2><p>Recorre una temporada completa, fuerza situaciones límite y comprueba el resultado sin tocar el juego real.</p></div><span>0 efectos reales</span></header>
      <div className="career-lab-start-grid">
        <article className="career-lab-create">
          <p className="eyebrow">NUEVA SIMULACIÓN</p><h3>Configura al mánager de prueba</h3>
          <div className="career-lab-form-grid">
            <label>Usuario<select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value, sourceCareerId: "" })}>{options.users.map((user) => <option value={user.id} key={user.id}>{user.name} · {user.email}</option>)}</select></label>
            <label>Partir de una Carrera<select value={form.sourceCareerId} onChange={(e) => { const source = options.careers.find((career) => career.id === e.target.value); setForm({ ...form, sourceCareerId: e.target.value, competitionId: source?.competitionId ?? form.competitionId, sportsClubId: source?.sportsClubId ?? form.sportsClubId, difficulty: source?.difficulty ?? form.difficulty }); }}><option value="">Crear copia desde un equipo</option>{availableCareers.map((career) => <option value={career.id} key={career.id}>{career.sportsClubName} · J{career.matchday}</option>)}</select></label>
            <label>Competición<select disabled={!!form.sourceCareerId} value={form.competitionId} onChange={(e) => setForm({ ...form, competitionId: e.target.value, sportsClubId: "" })}>{Object.entries(competitionNames).map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
            <label>Equipo<select disabled={!!form.sourceCareerId} value={form.sportsClubId} onChange={(e) => setForm({ ...form, sportsClubId: e.target.value })}>{availableTeams.map((team) => <option value={team.id} key={team.id}>{team.name} · {team.playerCount} jugadores</option>)}</select></label>
            <label>Exigencia<select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}><option value="relaxed">Cantera</option><option value="balanced">Profesional</option><option value="elite">Élite</option></select></label>
            <label>Comportamiento<select value={form.profile} onChange={(e) => setForm({ ...form, profile: e.target.value as CareerLabProfile })}><option value="conservative">Conservador</option><option value="competitive">Competitivo</option><option value="academy">Cantera</option><option value="chaotic">Caótico</option><option value="custom">Personalizado</option></select></label>
            <label>Recorrido<select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as CareerLabMode })}><option value="guided">Guiado, paso a paso</option><option value="automatic">Automático</option></select></label>
            <label>Semilla<input value={form.seed} onChange={(e) => setForm({ ...form, seed: e.target.value })} /></label>
          </div>
          <button className="primary-button" disabled={busy || !form.userId || !form.sportsClubId} onClick={() => void createSession()}>{busy ? "Preparando…" : "Crear laboratorio →"}</button>
        </article>
        <article className="career-lab-sessions"><p className="eyebrow">SESIONES GUARDADAS</p><h3>Continúa una prueba</h3>{sessions.length ? sessions.map((session) => <button key={session.id} onClick={() => void loadCareerLabState(session.id).then(setLab)}><span>{session.sportsClubName?.slice(0, 2).toUpperCase()}</span><p><strong>{session.title}</strong><small>{session.userName} · J{session.matchday}/{session.maximumMatchday} · {phaseNames[session.phase]}</small></p><b>Continuar →</b></button>) : <div className="career-lab-empty">Aún no hay simulaciones. Crea la primera sin riesgo para los datos reales.</div>}</article>
      </div>
      {error && <p className="form-error">{error}</p>}
    </section>
  );

  return (
    <section className="career-lab-page">
      <header className="career-lab-session-header"><button onClick={() => setLab(null)}>← Sesiones</button><div><p className="eyebrow">LABORATORIO · {competitionNames[lab.session.competitionId] ?? lab.session.competitionId}</p><h2>{lab.session.title}</h2><small>Jornada {lab.session.matchday} de {lab.session.maximumMatchday} · {phaseNames[lab.session.phase]}</small></div><div className="career-lab-observer-actions"><span>ENTORNO AISLADO</span><button onClick={() => void copyObserverLink()}>Copiar enlace</button><button onClick={() => window.open(observerUrl(), "_blank", "noopener,noreferrer")}>Abrir observador ↗</button></div></header>
      <nav className="career-lab-tabs">{([['control','Temporada'],['calendar','Calendario'],['events','Eventos'],['report','Informes'],['preview','Vista del usuario']] as const).map(([id, label]) => <button className={tab === id ? "active" : ""} onClick={() => setTab(id)} key={id}>{label}</button>)}</nav>
      {error && <p className="form-error career-lab-visible-error" role="alert">{error}</p>}
      {tab === "control" && <>
        <div className="career-lab-kpis"><article><small>Jornada</small><strong>{lab.session.matchday}<i>/{lab.session.maximumMatchday}</i></strong></article><article><small>Confianza</small><strong>{lab.state.confidence}<i>/100</i></strong></article><article><small>Reputación</small><strong>{lab.state.reputation}<i>/100</i></strong></article><article><small>Puntos</small><strong>{lab.state.sportingPoints}</strong></article><article><small>Presupuesto</small><strong>{Number(lab.state.budget).toFixed(1)} M</strong></article></div>
        {lab.session.phase==="interlude"&&activeInterlude&&<article className="career-lab-admin-interlude"><header><span>II</span><div><p className="eyebrow">RELOJ DEL INTERLUDIO · J{lab.session.matchday} CERRADA</p><h3>Día {interludeDay} de {interludeActivityDays}</h3><p>La J{Number(activeInterlude.toMatchday??lab.session.matchday+1)} se abrirá el {new Date(String(activeInterlude.endsAt)).toLocaleDateString("es-ES",{day:"numeric",month:"long",year:"numeric"})}. El observador elige una actividad y tú controlas cuándo pasa el día.</p></div><strong>{Math.round(((interludeDay-1)/interludeActivityDays)*100)}%</strong></header><div className="career-lab-admin-interlude-progress"><i style={{width:`${Math.max(3,((interludeDay-1)/interludeActivityDays)*100)}%`}}/></div><section><p><small>ACTIVIDAD DEL DÍA</small><strong>{interludeActionToday?String(interludeActionToday.title??interludeActionToday.strategy):"Pendiente del usuario"}</strong><span>{interludeActionToday?String(interludeActionToday.detail??"Actividad completada"):"Puedes avanzar sin actividad; el día quedará registrado como omitido."}</span></p><button className="primary-button" disabled={busy} onClick={()=>void execute(()=>stepCareerLab(lab.session.id,"advance_interlude_day"),interludeDay>=interludeActivityDays?`Interludio finalizado: J${Number(activeInterlude.toMatchday??lab.session.matchday+1)} abierta`:`Interludio avanzado al día ${interludeDay+1}`)}>{interludeDay>=interludeActivityDays?`Finalizar y abrir J${Number(activeInterlude.toMatchday??lab.session.matchday+1)}`:"Avanzar un día →"}</button></section></article>}
        <div className="career-lab-control-grid"><article className="career-lab-step"><p className="eyebrow">CONTROL DE TEMPORADA</p><h3>{phaseNames[lab.session.phase]}</h3><p>{lab.lastReport?.detail ?? "La sesión está lista. Cada acción crea un punto de control reversible."}</p><div>{nextAction && <button className="primary-button" disabled={busy} onClick={() => void execute(() => stepCareerLab(lab.session.id, nextAction, { strategy: "recovery" }), `${nextActionLabel[nextAction]} completado`)}>{nextActionLabel[nextAction]} →</button>}<button className="secondary-button" disabled={busy} onClick={() => void execute(() => stepCareerLab(lab.session.id, lab.session.status === "paused" ? "resume" : "pause"), lab.session.status === "paused" ? "Simulación reanudada" : "Simulación pausada")}>{lab.session.status === "paused" ? "Reanudar" : "Pausar"}</button></div></article>
          <article className="career-lab-auto"><p className="eyebrow">CIERRE AUTOMÁTICO</p><h3>Ejecuta el cierre completo de la jornada</h3><p>Prepara y bloquea el once, simula los partidos, calcula puntos, aplica decisiones y objetivos, genera el informe y abre la siguiente jornada.</p><div><button disabled={busy} onClick={() => void execute(() => runCareerLab(lab.session.id, "matchday"), "Jornada cerrada y siguiente jornada habilitada")}>Cerrar jornada completa →</button><button disabled={busy} onClick={() => void execute(() => runCareerLab(lab.session.id, "next_interlude"), "Simulación detenida en el próximo interludio")}>Cerrar hasta interludio</button><button disabled={busy} onClick={() => void execute(() => runCareerLab(lab.session.id, "next_failure"), "Simulación detenida en el próximo fallo")}>Cerrar hasta fallo</button><button className="dark" disabled={busy} onClick={() => void execute(() => runCareerLab(lab.session.id, "season_end"), "Temporada completa simulada")}>Cerrar temporada completa →</button></div></article></div>
        <div className="career-lab-safety"><span>{failedChecks.length ? "!" : "✓"}</span><p><strong>{failedChecks.length ? `${failedChecks.length} comprobaciones requieren atención` : "Aislamiento e integridad correctos"}</strong><small>{failedChecks.length ? failedChecks.map((check) => check.label).join(" · ") : "No se han generado monedas, logros, notificaciones, mercados ni cambios en carreras reales."}</small></p><b>{lab.state.realSideEffects ?? 0} efectos reales</b></div>
        <article className="career-lab-checkpoints"><header><div><p className="eyebrow">PUNTOS DE CONTROL</p><h3>Vuelve a cualquier momento</h3></div><small>La semilla conserva resultados reproducibles</small></header><div>{lab.checkpoints.slice(0, 12).map((checkpoint) => <button key={checkpoint.id} onClick={() => void execute(() => restoreCareerLabCheckpoint(lab.session.id, checkpoint.id), "Punto de control restaurado")}><b>J{checkpoint.matchday}</b><span>{checkpoint.label}<small>{phaseNames[checkpoint.phase] ?? checkpoint.phase}</small></span><i>Restaurar</i></button>)}</div></article>
      </>}
      {tab === "calendar" && <section className="career-lab-calendar"><header><div><p className="eyebrow">CALENDARIO DE LA COPIA</p><h3>Mueve jornadas y provoca escenarios reales</h3><p>Estos cambios solo afectan al laboratorio. Si el hueco entre dos jornadas supera 10 días se genera automáticamente un interludio.</p></div><span>{calendar.filter((round) => round.interludeDetected).length} interludios detectados</span></header><div>{calendar.map((round) => <CareerLabCalendarRow key={round.matchday} round={round} busy={busy} localDate={localDate} onSave={saveRound} />)}</div></section>}
      {tab === "events" && <div className="career-lab-events-grid"><article><p className="eyebrow">INYECTOR DE EVENTOS</p><h3>Fuerza una situación concreta</h3><div className="career-lab-form-grid"><label>Jornada<input type="number" min="1" max={lab.session.maximumMatchday} value={event.matchday} onChange={(e) => setEvent({ ...event, matchday: Number(e.target.value) })} /></label><label>Momento<select value={event.moment} onChange={(e) => setEvent({ ...event, moment: e.target.value })}><option value="before_preparation">Antes de preparar</option><option value="after_lineup">Después del once</option><option value="after_lock">Después del bloqueo</option><option value="before_close">Antes del cierre</option><option value="after_close">Después del cierre</option></select></label><label>Situación<select value={event.type} onChange={(e) => setEvent({ ...event, type: e.target.value })}>{Object.entries(eventNames).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><label>Jugador<select value={event.playerId} onChange={(e) => setEvent({ ...event, playerId: e.target.value })}><option value="">No aplica</option>{lab.state.squad.map((player) => <option value={player.id} key={player.id}>{player.name} · {player.position}</option>)}</select></label><label>Nuevo equipo / dato<input value={event.newClub} onChange={(e) => setEvent({ ...event, newClub: e.target.value })} /></label><label>Título<input value={event.title} onChange={(e) => setEvent({ ...event, title: e.target.value })} /></label></div><button className="primary-button" disabled={busy} onClick={() => void addEvent()}>Añadir a la temporada →</button></article><article className="career-lab-timeline"><p className="eyebrow">LÍNEA TEMPORAL</p><h3>{lab.events.length} eventos programados</h3>{lab.events.length ? lab.events.map((item) => <div key={item.id}><b>J{item.matchday}</b><p><strong>{item.title}</strong><small>{eventNames[item.type]} · {item.status}</small></p></div>) : <div className="career-lab-empty">No hay incidencias. Puedes recorrer una temporada normal o añadir casos extremos.</div>}</article></div>}
      {tab === "report" && <div className="career-lab-report"><header><div><p className="eyebrow">INFORME TRAZABLE</p><h3>{lab.state.reports.length} jornadas evaluadas</h3></div><span>Semilla: {lab.session.seed}</span></header><div className="career-lab-report-list">{lab.logs.map((log) => <article className={log.severity} key={log.sequence}><b>{log.sequence}</b><span><strong>{log.title}</strong><small>J{log.matchday} · {phaseNames[log.phase] ?? log.phase}</small></span><p>{log.detail}</p><em>{log.checks?.filter((check) => check.passed).length ?? 0}/{log.checks?.length ?? 0} controles</em></article>)}</div></div>}
      {tab === "preview" && <div className="career-lab-live-preview"><header><div><p className="eyebrow">VISTA INTERACTIVA DEL USUARIO</p><h3>Interactúa como si estuvieras jugando</h3></div><button onClick={() => window.open(observerUrl(), "_blank", "noopener,noreferrer")}>Abrir en otro navegador ↗</button></header><iframe title="Carrera simulada del usuario" src={observerUrl()} /></div>}
      <footer className="career-lab-footer"><p>Esta sesión caduca automáticamente y puede eliminarse sin afectar al usuario seleccionado.</p><button disabled={busy} onClick={() => void execute(async () => { await deleteCareerLab(lab.session.id); setLab(null); }, "Laboratorio eliminado")}>Eliminar sesión</button></footer>
    </section>
  );
}
