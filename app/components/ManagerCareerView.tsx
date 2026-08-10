"use client";

import { useEffect, useMemo, useState } from "react";
import type { CompetitionName, PlayerPosition } from "../data";
import type { CompetitionPlayer } from "../data/competition-players";
import type { MatchFixture } from "../services/nexo-calendar";
import { buyNexoCareerPlayer, loadNexoCareerRanking, loadNexoCareerWorkspace, markNexoCareerReportViewed, saveNexoCareerDecision, saveNexoCareerLineup, sellNexoCareerPlayer, type NexoCareer, type NexoCareerDecision, type NexoCareerDecisionChoice, type NexoCareerDecisionPrompt, type NexoCareerLineup, type NexoCareerMatchdayReport, type NexoCareerObjective, type NexoCareerPlayer, type NexoCareerRanking, type NexoCareerRankingRow, type NexoCareerWorkspace } from "../services/nexo-career";

type CareerRules = { minimumOriginalSquad: number; minimumOriginalLineup: number; weeklyDecisionEnabled: boolean; dismissalConfidenceThreshold: number; sameClubRankingEnabled: boolean };
type Area = "overview" | "lineup" | "market";
const formations: Record<string, Record<PlayerPosition, number>> = {
  "4-4-2": { POR: 1, DEF: 4, MED: 4, DEL: 2 }, "4-3-3": { POR: 1, DEF: 4, MED: 3, DEL: 3 }, "3-4-3": { POR: 1, DEF: 3, MED: 4, DEL: 3 }, "3-5-2": { POR: 1, DEF: 3, MED: 5, DEL: 2 }, "5-3-2": { POR: 1, DEF: 5, MED: 3, DEL: 2 },
};

function Avatar({ player }: { player: NexoCareerPlayer }) {
  return <span className="career-player-avatar">{player.photoUrl ? <img src={player.photoUrl} alt="" /> : player.initials}</span>;
}

function demoWorkspace(career: NexoCareer, players: Record<CompetitionName, CompetitionPlayer[]>): NexoCareerWorkspace {
  const squad = players[career.competition].filter((player) => player.club === career.sportsClubName).map((player) => ({ ...player, isOriginal: true, acquisitionValue: player.value })) as NexoCareerPlayer[];
  const market = players[career.competition].filter((player) => player.club !== career.sportsClubName).map((player) => ({ ...player, isOriginal: false, acquisitionValue: player.value })) as NexoCareerPlayer[];
  const objectives: NexoCareerObjective[] = [
    { id:"season",type:"season",title:"Objetivo deportivo",description:"Alcanza los puntos fantasy exigidos para toda la temporada.",targetValue:1800,currentValue:career.sportingPoints,reputationReward:25,failurePenalty:8,status:"active" },
    { id:"identity",type:"identity",title:"Protege la identidad",description:"Mantén al menos ocho jugadores originales en la plantilla.",targetValue:8,currentValue:squad.filter((player)=>player.isOriginal).length,reputationReward:8,failurePenalty:8,status:"active" },
    { id:"debut",type:"matchday",title:"Debut con carácter",description:"Supera 48 puntos fantasy en la primera jornada.",targetValue:48,currentValue:0,reputationReward:6,failurePenalty:8,status:"active",expiresMatchday:1 },
    { id:"confidence",type:"confidence",title:"Respaldo de la directiva",description:"Termina con al menos 70 puntos de confianza.",targetValue:70,currentValue:60,reputationReward:10,failurePenalty:8,status:"active" },
  ];
  const decisionPrompt: NexoCareerDecisionPrompt = { key:"youth_minutes",title:"El vestuario pide una señal",description:"Un joven reclama protagonismo antes de un partido importante.",choices:[{key:"academy",title:"Apostar por la cantera",summary:"Inversión de futuro con una condición deportiva.",reputationChange:3,confidenceChange:2,budgetChange:-0.5,sportingPointsChange:0,condition:"Alinea al menos 8 originales",conditionalBonus:3},{key:"experience",title:"Proteger el resultado",summary:"Menor impacto social, pero una ayuda deportiva segura.",reputationChange:1,confidenceChange:1,budgetChange:0,sportingPointsChange:1,conditionalBonus:0}] };
  return { budget: career.budget, matchday: career.matchday, boardConfidence: 60, consecutiveFailures: 0, contractTier: "stability", status: career.status, squad, market, lineups: [], decisions: [], objectives, events: [], reports: [], decisionPrompt };
}

export function ManagerCareerView({ career, players, fixtures, rules, backendEnabled, onCareerChanged, onBack, onNewCareer, notify }: { career?: NexoCareer; players: Record<CompetitionName, CompetitionPlayer[]>; fixtures: MatchFixture[]; rules: CareerRules; backendEnabled: boolean; onCareerChanged: () => Promise<void>; onBack: () => void; onNewCareer: () => void; notify: (value: string) => void }) {
  const [area, setArea] = useState<Area>("overview");
  const [workspace, setWorkspace] = useState<NexoCareerWorkspace | null>(null);
  const [ranking,setRanking]=useState<NexoCareerRanking|null>(null);
  const [rankingOpen,setRankingOpen]=useState(false);
  const [revealReport,setRevealReport]=useState<NexoCareerMatchdayReport|null>(null);
  const [lineupDraft, setLineupDraft] = useState<NexoCareerLineup | null>(null);
  const [selectedLineupMatchday, setSelectedLineupMatchday] = useState(career?.matchday ?? 1);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (!career) return;
    setLoading(true);
    try {
      if(backendEnabled){const nextWorkspace=await loadNexoCareerWorkspace(career.id);setWorkspace(nextWorkspace);setRevealReport((current)=>current??nextWorkspace.reports.find((report)=>!report.viewedAt)??null);const nextRanking=rules.sameClubRankingEnabled?await loadNexoCareerRanking(career.id).catch(()=>null):null;setRanking(nextRanking)}
      else {setWorkspace(demoWorkspace(career,players));setRanking({enabled:rules.sameClubRankingEnabled,completedMatchdays:0,totalManagers:1,rows:[{careerId:career.id,position:1,managerName:"Tú",initials:"TU",status:career.status,totalPoints:career.sportingPoints,averagePoints:0,bestMatchday:0,reputation:career.reputation,confidence:60,completedObjectives:0,budget:career.budget,isCurrent:true}]})}
    }
    catch (error) { setWorkspace(demoWorkspace(career, players)); notify(error instanceof Error ? error.message : "No se ha podido cargar la Carrera"); }
    finally { setLoading(false); }
  }

  useEffect(() => { setArea("overview"); setLineupDraft(null); setRankingOpen(false); setRevealReport(null); void refresh(); }, [career?.id]);
  useEffect(() => { setSelectedLineupMatchday(career?.matchday ?? 1); setLineupDraft(null); }, [career?.matchday]);
  if (!career) return <section className="career-empty-page"><span>M</span><p className="eyebrow">CARRERA DE MÁNAGER</p><h1>Tu historia aún no ha empezado</h1><p>Elige un club real y afronta una temporada de objetivos, decisiones y reputación.</p><button className="primary-button" onClick={onNewCareer}>Elegir mi club</button></section>;
  const state = workspace ?? demoWorkspace(career, players);
  if (state.status === "dismissed") return <section className="manager-career-page dismissed-career-page"><header className="career-topline"><button className="career-topline-action back" onClick={onBack}><span>←</span>Volver a Clubes</button><p><span>CARRERA DE MÁNAGER</span><strong>{career.sportsClubName}</strong><small>{career.seasonLabel} · Carrera finalizada</small></p><button className="career-topline-action new" onClick={onNewCareer}><span>＋</span>Nueva carrera</button></header><DismissedCareerView career={career} workspace={state} rules={rules} ranking={ranking} onRanking={()=>setRankingOpen(true)} onBack={onBack} onNewCareer={onNewCareer}/>{rankingOpen&&ranking&&<CareerRankingDialog career={career} ranking={ranking} onClose={()=>setRankingOpen(false)}/>}</section>;
  const currentDecision = state.decisions.find((item) => item.matchday === career.matchday);
  const nextFixture = fixtures.filter((fixture) => fixture.competition === career.competition && fixture.matchday >= career.matchday && fixture.status !== "final").find((fixture) => fixture.home === career.sportsClubName || fixture.away === career.sportsClubName);
  const alignedPlayerIds = lineupDraft?.playerIds ?? state.lineups.find((item) => item.matchday === career.matchday)?.playerIds ?? [];

  async function decide(choice: NexoCareerDecisionChoice) {
    if (busy) return;
    setBusy(true);
    try {
      if (backendEnabled) { await saveNexoCareerDecision(career!.id, state.decisionPrompt!.key, choice.key); await Promise.all([refresh(), onCareerChanged()]); }
      else {
        const decision: NexoCareerDecision = { matchday: career!.matchday, decisionKey: state.decisionPrompt!.key, choiceKey: choice.key, choiceTitle: choice.title, consequence: choice.summary, reputationChange: choice.reputationChange, confidenceChange: choice.confidenceChange, budgetChange: choice.budgetChange, sportingPointsChange: choice.sportingPointsChange, conditionalOriginalTarget: choice.condition ? Number(choice.condition.match(/\d+/)?.[0]) : undefined, conditionalSportingBonus: choice.conditionalBonus, decidedAt: new Date().toISOString() };
        setWorkspace((current) => ({ ...(current ?? state), decisions: [decision, ...(current ?? state).decisions] }));
      }
      notify("Decisión guardada. Ya no puede modificarse esta jornada.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se ha podido guardar la decisión"); }
    finally { setBusy(false); }
  }

  async function saveLineup(lineup: NexoCareerLineup) {
    if (backendEnabled) await saveNexoCareerLineup({ careerId: career!.id, ...lineup });
    setLineupDraft(lineup);
    setWorkspace((current) => ({ ...(current ?? state), lineups: [lineup, ...(current ?? state).lineups.filter((item) => item.matchday !== lineup.matchday)] }));
    notify(`Once de la Jornada ${lineup.matchday} guardado`);
  }

  async function operate(type: "buy" | "sell", player: NexoCareerPlayer) {
    if (busy) return;
    setBusy(true);
    try {
      if (backendEnabled) {
        if (type === "buy") await buyNexoCareerPlayer(career!.id, player.id); else await sellNexoCareerPlayer(career!.id, player.id);
        await Promise.all([refresh(), onCareerChanged()]);
      } else setWorkspace((current) => {
        const value = current ?? state;
        return type === "buy" ? { ...value, budget: value.budget - player.value, squad: [...value.squad, player], market: value.market.filter((item) => item.id !== player.id) } : { ...value, budget: value.budget + player.value, squad: value.squad.filter((item) => item.id !== player.id), market: [...value.market, { ...player, isOriginal: false }] };
      });
      if (type === "sell") setLineupDraft((current) => current ? { ...current, playerIds: current.playerIds.filter((id) => id !== player.id), captainId: current.captainId === player.id ? "" : current.captainId } : current);
      notify(`${player.name} ${type === "buy" ? "fichado" : "vendido"} por ${player.value.toFixed(1).replace(".", ",")} M`);
    } catch (error) { notify(error instanceof Error ? error.message : "No se ha podido completar la operación"); }
    finally { setBusy(false); }
  }

  async function closeReveal(next:"report"|"lineup"){
    if(!revealReport)return;
    try{if(backendEnabled)await markNexoCareerReportViewed(career!.id,revealReport.matchday)}catch(error){notify(error instanceof Error?error.message:"No se pudo confirmar el informe")}
    setWorkspace((current)=>current?{...current,reports:current.reports.map((report)=>report.matchday===revealReport.matchday?{...report,viewedAt:new Date().toISOString()}:report)}:current);
    setRevealReport(null);setArea(next==="lineup"?"lineup":"overview");
  }

  return <section className="manager-career-page">
    <header className="career-topline"><button className="career-topline-action back" onClick={area === "overview" ? onBack : () => setArea("overview")}><span>←</span>{area === "overview" ? "Volver a Clubes" : "Volver al resumen"}</button><p><span>CARRERA DE MÁNAGER</span><strong>{career.sportsClubName}</strong><small>{career.seasonLabel} · Jornada {career.matchday}</small></p><button className="career-topline-action new" onClick={onNewCareer}><span>＋</span>Nueva carrera</button></header>
    <nav className="career-area-tabs"><button className={area === "overview" ? "active" : ""} onClick={() => setArea("overview")}>Resumen</button><button className={area === "lineup" ? "active" : ""} onClick={() => setArea("lineup")}>Mi once</button><button className={area === "market" ? "active" : ""} onClick={() => setArea("market")}>Mercado</button></nav>
    {loading ? <div className="career-workspace-loading"><strong>Preparando tu despacho…</strong><span>Cargando plantilla, once y mercado individual.</span></div> : area === "lineup" ? <CareerLineupHistory career={career} workspace={state} rules={rules} draft={lineupDraft} selectedMatchday={selectedLineupMatchday} catalog={players[career.competition]} onSelectMatchday={setSelectedLineupMatchday} onDraftChange={setLineupDraft} onSave={saveLineup} notify={notify} /> : area === "market" ? <CareerMarket career={career} workspace={state} rules={rules} alignedPlayerIds={alignedPlayerIds} busy={busy} onOperation={operate} /> : <CareerOverview career={career} workspace={state} nextFixture={nextFixture} rules={rules} decision={currentDecision} ranking={ranking} busy={busy} onArea={setArea} onDecision={decide} onRanking={()=>setRankingOpen(true)} />}
    {rankingOpen&&ranking&&<CareerRankingDialog career={career} ranking={ranking} onClose={()=>setRankingOpen(false)}/>} 
    {revealReport&&<CareerMatchdayReveal career={career} report={revealReport} onClose={closeReveal}/>} 
  </section>;
}

function CareerRankingPreview({ career, ranking, onOpen }: { career: NexoCareer; ranking: NexoCareerRanking|null; onOpen: () => void }) {
  if(!ranking?.enabled)return null;
  const ownIndex=ranking.rows.findIndex((row)=>row.isCurrent);
  const nearby=ranking.rows.slice(Math.max(0,ownIndex-2),Math.max(5,ownIndex+3));
  const own=ranking.rows[ownIndex];
  return <section className="career-ranking-preview"><div className="section-title"><div><p className="eyebrow">MISMO CLUB · MISMA DIFICULTAD</p><h2>¿Cómo vas frente a otros mánagers?</h2><p>Solo se comparan Carreras de {career.sportsClubName} con {ranking.completedMatchdays} jornadas cerradas.</p></div>{ranking.totalManagers>1&&<button className="text-button" onClick={onOpen}>Ver clasificación completa →</button>}</div>{ranking.totalManagers<=1?<article className="career-ranking-empty"><span>01</span><p><strong>Eres el primer mánager comparable</strong><small>Tu posición aparecerá aquí cuando otros usuarios alcancen la misma jornada con este club y dificultad.</small></p></article>:<><div className="career-ranking-own"><span>{own?.position??"—"}º</span><p><small>TU POSICIÓN</small><strong>{own?.totalPoints.toFixed(0)??0} puntos</strong><em>{own?.averagePoints.toFixed(1).replace(".",",")??"0,0"} de media · {own?.completedObjectives??0} objetivos</em></p><b>{ranking.totalManagers} mánagers</b></div><div className="career-ranking-nearby">{nearby.map((row)=><CareerRankingRowCard key={row.careerId} row={row}/>)}</div></>}</section>;
}

function CareerRankingRowCard({ row }: { row: NexoCareerRankingRow }) {
  const status=row.status==="dismissed"?"Destituido":row.status==="completed"?"Finalizada":"En curso";
  return <article className={row.isCurrent?"current":""}><b>{row.position}</b><span>{row.initials}</span><p><strong>{row.isCurrent?"Tú":row.managerName}</strong><small>{status} · {row.completedObjectives} objetivos</small></p><em>{row.totalPoints.toFixed(0)} pts<small>{row.averagePoints.toFixed(1).replace(".",",")} media</small></em></article>;
}

function CareerRankingDialog({ career, ranking, onClose }: { career: NexoCareer; ranking: NexoCareerRanking; onClose: () => void }) {
  return <div className="dialog-backdrop"><section className="career-ranking-dialog" role="dialog" aria-modal="true" aria-labelledby="career-ranking-title"><header><div><p className="eyebrow">CLASIFICACIÓN DE MÁNAGERS</p><h2 id="career-ranking-title">{career.sportsClubName} · {career.seasonLabel}</h2><p>{career.difficulty==="elite"?"Élite":career.difficulty==="relaxed"?"Cantera":"Profesional"} · {ranking.completedMatchdays} jornadas comparables</p></div><button onClick={onClose}>×</button></header><div className="career-ranking-rules"><b>ORDEN Y DESEMPATE</b><span><strong>1</strong> Puntos totales</span><span><strong>2</strong> Objetivos cumplidos</span><span><strong>3</strong> Confianza</span><em>Si todo coincide, comparten posición.</em>{ranking.completedMatchdays===0&&<small>Aún no hay puntos: ahora las decisiones de confianza marcan las diferencias.</small>}</div><div className="career-ranking-table-head"><span>POS.</span><span aria-hidden="true"></span><span>MÁNAGER</span><span>PUNTOS</span><span>MEDIA</span><span>MEJOR J.</span><span>OBJ.</span><span>CONFIANZA</span></div><div className="career-ranking-table">{ranking.rows.map((row)=><article className={row.isCurrent?"current":""} key={row.careerId}><b>{row.position}</b><span>{row.initials}</span><p><strong>{row.isCurrent?"Tú":row.managerName}</strong><small>{row.status==="dismissed"?"Destituido":row.status==="completed"?"Finalizada":"En curso"}</small></p><em>{row.totalPoints.toFixed(0)}</em><em>{row.averagePoints.toFixed(1).replace(".",",")}</em><em>{row.bestMatchday.toFixed(0)}</em><em>{row.completedObjectives}</em><em>{row.confidence}/100</em></article>)}</div><footer><span>Solo se comparan mánagers con el mismo club, dificultad y jornadas cerradas.</span><button onClick={onClose}>Cerrar</button></footer></section></div>;
}

function DismissedCareerView({ career, workspace, rules, ranking, onRanking, onBack, onNewCareer }: { career: NexoCareer; workspace: NexoCareerWorkspace; rules: CareerRules; ranking: NexoCareerRanking|null; onRanking: () => void; onBack: () => void; onNewCareer: () => void }) {
  const completed=workspace.objectives.filter((objective)=>objective.status==="completed").length;
  const failed=workspace.objectives.filter((objective)=>objective.status==="failed").length;
  const finalPoints=workspace.lineups.reduce((sum,lineup)=>sum+(lineup.points??0),0)||career.sportingPoints;
  const lastLineup=[...workspace.lineups].sort((a,b)=>b.matchday-a.matchday)[0];
  const timeline=workspace.events.slice(0,8);
  return <>
    <article className="dismissal-hero"><div><span>CONTRATO FINALIZADO</span><p className="eyebrow">VEREDICTO DE LA DIRECTIVA</p><h1>Tu etapa en {career.sportsClubName} ha terminado.</h1><p>La directiva ha retirado su confianza después de {workspace.consecutiveFailures} misiones fallidas consecutivas. La Carrera queda cerrada y se conserva como historial.</p><div><button onClick={onNewCareer}>Empezar otra Carrera →</button><button onClick={onBack}>Volver a mis clubes</button></div></div><section><small>CONFIANZA FINAL</small><strong>{workspace.boardConfidence}<i>/100</i></strong><p>Umbral de destitución: {rules.dismissalConfidenceThreshold}/100</p><b>DESTITUIDO</b></section></article>
    <div className="dismissal-kpis"><article><small>JORNADAS DIRIGIDAS</small><strong>{Math.max(0,workspace.matchday-1)}</strong></article><article><small>PUNTOS CONSEGUIDOS</small><strong>{finalPoints.toFixed(0)}</strong></article><article><small>OBJETIVOS CUMPLIDOS</small><strong>{completed}</strong></article><article><small>OBJETIVOS FALLADOS</small><strong>{failed}</strong></article><article><small>DECISIONES TOMADAS</small><strong>{workspace.decisions.length}</strong></article></div>
    <div className="dismissal-content-grid"><article className="dismissal-verdict"><p className="eyebrow">POR QUÉ HA OCURRIDO</p><h2>El límite estaba en {rules.dismissalConfidenceThreshold}</h2><div><span>{workspace.consecutiveFailures}/3</span><p><strong>Racha de fallos completa</strong><small>La tercera misión consecutiva incumplida activó la revisión del puesto.</small></p></div><div><span>{workspace.boardConfidence}</span><p><strong>Confianza insuficiente</strong><small>La confianza terminó en el umbral de destitución o por debajo.</small></p></div><footer>No puedes modificar esta Carrera, pero todos sus datos, decisiones y alineaciones permanecen disponibles.</footer></article><article className="dismissal-last-lineup"><p className="eyebrow">ÚLTIMO ONCE</p><h2>{lastLineup?`Jornada ${lastLineup.matchday} · ${lastLineup.formation}`:"Sin alineación registrada"}</h2>{lastLineup?<><strong>{lastLineup.points?.toFixed(0)??"—"} puntos</strong><div>{workspace.squad.filter((player)=>lastLineup.playerIds.includes(player.id)).map((player)=><span key={player.id}><Avatar player={player}/><small>{player.name}{player.id===lastLineup.captainId?" · C":""}</small></span>)}</div></>:<p>No se guardó un once antes de finalizar la etapa.</p>}</article></div>
    <CareerRankingPreview career={career} ranking={ranking} onOpen={onRanking}/>
    <section className="dismissal-timeline"><div className="section-title"><div><p className="eyebrow">HISTORIAL DEFINITIVO</p><h2>La historia que queda</h2><p>Las operaciones y decisiones anteriores permanecen en modo consulta.</p></div></div>{timeline.length?<div>{timeline.map((event,index)=><article key={`${event.createdAt}-${index}`}><span>{event.matchday?`J${event.matchday}`:"INICIO"}</span><p><strong>{event.title}</strong><small>{event.detail}</small></p><time>{new Date(event.createdAt).toLocaleDateString("es-ES",{day:"2-digit",month:"short"})}</time></article>)}</div>:<p className="empty-state">Todavía no hay movimientos registrados en el historial.</p>}</section>
  </>;
}

function CareerMatchdayReveal({career,report,onClose}:{career:NexoCareer;report:NexoCareerMatchdayReport;onClose:(next:"report"|"lineup")=>void}){
  const passed=report.mission?.status==="completed";
  const confidenceChange=report.confidenceAfter-report.confidenceBefore;
  const rankingMove=report.previousRankingPosition&&report.rankingPosition?report.previousRankingPosition-report.rankingPosition:undefined;
  const best=[...report.players].sort((a,b)=>b.finalPoints-a.finalPoints).slice(0,3);
  return <div className="career-reveal-backdrop"><section className={`career-matchday-reveal ${passed?"passed":"failed"}`} role="dialog" aria-modal="true" aria-labelledby="career-reveal-title">
    <button className="career-reveal-close" onClick={()=>onClose("report")} aria-label="Cerrar">×</button>
    <div className="career-reveal-orbit" aria-hidden="true"><i/><i/><i/></div>
    <header><span>J{report.matchday}</span><p className="eyebrow">FINAL DE JORNADA · {career.sportsClubName.toUpperCase()}</p><h2 id="career-reveal-title">{passed?"Has respondido.":"Toca reaccionar."}</h2><p>{passed?"El equipo cumple, la directiva toma nota y tu proyecto avanza.":"La misión no se ha cumplido. La próxima jornada será decisiva para recuperar confianza."}</p></header>
    <div className="career-reveal-score"><small>RESULTADO DEFINITIVO</small><strong>{report.totalPoints.toFixed(0)}</strong><span>puntos</span><p>{report.lineupPoints.toFixed(0)} del once{report.decisionPoints?` · ${report.decisionPoints>0?"+":""}${report.decisionPoints.toFixed(0)} por tu decisión`:""}</p></div>
    <div className="career-reveal-verdict">
      <article><small>MISIÓN</small><strong>{passed?"CUMPLIDA":"FALLADA"}</strong><span>{report.mission?.title??"Sin misión asignada"}</span></article>
      <article><small>CONFIANZA</small><strong>{report.confidenceAfter}/100</strong><span className={confidenceChange<0?"negative":"positive"}>{confidenceChange>0?"+":""}{confidenceChange}</span></article>
      <article><small>RANKING</small><strong>{report.rankingPosition?`${report.rankingPosition}º`:"—"}</strong><span>{rankingMove?`${rankingMove>0?"▲":"▼"} ${Math.abs(rankingMove)} puestos`:"Nueva referencia"}</span></article>
    </div>
    {best.length>0&&<div className="career-reveal-best"><small>LOS QUE TIRARON DEL EQUIPO</small>{best.map((player,index)=><article key={player.playerId}><b>0{index+1}</b>{player.photoUrl?<img src={player.photoUrl} alt=""/>:<i>{player.initials}</i>}<p><strong>{player.name}</strong><span>{player.isCaptain?"Capitán · ":""}{player.position}</span></p><em>{player.finalPoints.toFixed(0)} pts</em></article>)}</div>}
    <footer><button onClick={()=>onClose("report")}>Ver informe completo</button>{report.statusAfter!=="dismissed"&&<button onClick={()=>onClose("lineup")}>Preparar Jornada {report.matchday+1} →</button>}</footer>
  </section></div>;
}

function CareerMatchdayReportCard({report,onPrepare}:{report:NexoCareerMatchdayReport;onPrepare:()=>void}){
  const [expanded,setExpanded]=useState(false);
  const missionPassed=report.mission?.status==="completed";
  const confidenceChange=report.confidenceAfter-report.confidenceBefore;
  const reputationChange=report.reputationAfter-report.reputationBefore;
  const budgetChange=report.budgetAfter-report.budgetBefore;
  const signed=(value:number,suffix="")=>`${value>0?"+":""}${value.toFixed(suffix===" M"?2:0).replace(".",",")}${suffix}`;
  const rankingMove=report.rankingPosition&&report.previousRankingPosition
    ? report.previousRankingPosition-report.rankingPosition
    : undefined;
  return <section className={`career-matchday-report ${missionPassed?"passed":"failed"}`}>
    <header><div><p className="eyebrow">JORNADA {report.matchday} · INFORME FINAL</p><h2>{missionPassed?"Misión cumplida":"La directiva esperaba más"}</h2><p>El resultado ya está cerrado y esta acta no cambiará aunque se actualicen las reglas.</p></div><strong>{report.totalPoints.toFixed(0)}<small>puntos</small></strong></header>
    <div className="career-report-summary">
      <article><small>ONCE</small><strong>{report.lineupPoints.toFixed(0)} pts</strong><span>{report.formation??"Sin formación"}</span></article>
      <article><small>MISIÓN</small><strong>{missionPassed?"Cumplida":"Fallada"}</strong><span>{report.mission?`${report.mission.currentValue.toFixed(0)} / ${report.mission.targetValue.toFixed(0)}`:"Sin misión"}</span></article>
      <article><small>CONFIANZA</small><strong>{report.confidenceAfter}/100</strong><span className={confidenceChange<0?"negative":"positive"}>{signed(confidenceChange)}</span></article>
      <article><small>CLASIFICACIÓN</small><strong>{report.rankingPosition?`${report.rankingPosition}º`:"—"}</strong><span>{rankingMove?`${rankingMove>0?"Subes":"Bajas"} ${Math.abs(rankingMove)}`:report.previousRankingPosition?"Sin cambios":"Primera referencia"}</span></article>
    </div>
    {expanded&&<div className="career-report-details">
      <article className="career-report-players"><header><div><small>DESGLOSE DEL ONCE</small><strong>El capitán ya incluye su multiplicador</strong></div><b>{report.lineupPoints.toFixed(0)} pts</b></header><div>{report.players.map((player)=><span key={player.playerId} className={player.isCaptain?"captain":""}>{player.photoUrl?<img src={player.photoUrl} alt=""/>:<i>{player.initials}</i>}<p><strong>{player.name}</strong><small>{player.position}{player.isCaptain?` · Capitán ×${player.multiplier}`:""}</small></p><b>{player.finalPoints.toFixed(0)}</b></span>)}</div></article>
      <div className="career-report-consequences">
        <article><small>RESULTADO DE LA MISIÓN</small><strong>{report.mission?.title??"Sin misión asignada"}</strong><p>{report.mission?.description}</p>{report.mission&&<b className={missionPassed?"positive":"negative"}>{missionPassed?`+${report.mission.reward} de recompensa`:`-${report.mission.penalty} de confianza`}</b>}</article>
        <article><small>DECISIÓN DE LA JORNADA</small><strong>{report.decision?.choiceTitle??"Sin decisión tomada"}</strong><p>{report.decision?.consequence??"No hubo efectos adicionales."}</p>{report.decision&&<b>{report.decisionPoints>0?`+${report.decisionPoints.toFixed(0)} puntos aplicados`:report.decision.conditionalOriginalTarget&&!report.decision.conditionMet?"No se cumplió la condición del bonus":"Sin puntos adicionales"}</b>}</article>
        <article><small>BALANCE FINAL</small><strong>{report.statusAfter==="dismissed"?"Destituido":report.consecutiveFailuresAfter?`${report.consecutiveFailuresAfter}/3 fallos seguidos`:"Racha limpia"}</strong><p>Reputación {report.reputationAfter}/100 · Presupuesto {report.budgetAfter.toFixed(2).replace(".",",")} M</p><b>{signed(reputationChange," REP")} · {signed(budgetChange," M")}</b></article>
      </div>
    </div>}
    <footer><button onClick={()=>setExpanded(!expanded)}>{expanded?"Ocultar desglose":"Ver cómo se ha calculado"}</button><button onClick={onPrepare}>Preparar Jornada {report.matchday+1} →</button></footer>
  </section>;
}

function CareerOverview({ career, workspace, nextFixture, rules, decision, ranking, busy, onArea, onDecision, onRanking }: { career: NexoCareer; workspace: NexoCareerWorkspace; nextFixture?: MatchFixture; rules: CareerRules; decision?: NexoCareerDecision; ranking: NexoCareerRanking|null; busy: boolean; onArea: (area: Area) => void; onDecision: (choice: NexoCareerDecisionChoice) => void; onRanking: () => void }) {
  const [pendingChoice,setPendingChoice]=useState<NexoCareerDecisionChoice|null>(null);
  const seasonObjective=workspace.objectives.find((item)=>item.type==="season");
  const matchdayObjective=workspace.objectives.find((item)=>item.type==="matchday"&&item.expiresMatchday===career.matchday);
  const identityObjective=workspace.objectives.find((item)=>item.type==="identity");
  const confidenceObjective=workspace.objectives.find((item)=>item.type==="confidence");
  const originalCount=workspace.squad.filter((item)=>item.isOriginal).length;
  const objectiveValue=(objective:NexoCareerObjective)=>objective.type==="identity"?originalCount:objective.type==="confidence"?workspace.boardConfidence:objective.type==="season"?career.sportingPoints:objective.currentValue;
  const progress=seasonObjective?Math.min(100,Math.round((objectiveValue(seasonObjective)/seasonObjective.targetValue)*100)):0;
  const tierLabel=workspace.contractTier==="title"?"Luchar por el título":workspace.contractTier==="europe"?"Competir arriba":"Construir y consolidar";
  const dismissalThreshold=rules.dismissalConfidenceThreshold;
  const confidenceMargin=Math.max(0,workspace.boardConfidence-dismissalThreshold);
  const jobRisk=workspace.consecutiveFailures>=2||workspace.boardConfidence<=dismissalThreshold+5?"danger":workspace.consecutiveFailures>=1||workspace.boardConfidence<=dismissalThreshold+20?"warning":"safe";
  const jobRiskLabel=jobRisk==="danger"?"Puesto en peligro":jobRisk==="warning"?"En observación":"Puesto seguro";
  const latestReport=workspace.reports[0];
  const formatSigned=(value:number,suffix:string)=>`${value>0?"+":""}${value.toFixed(suffix===" M"?2:0).replace(".",",")}${suffix}`;
  const immediateEffects=(choice:NexoCareerDecisionChoice)=>[
    `${formatSigned(choice.reputationChange," REP")} de reputación`,
    `${formatSigned(choice.confidenceChange," CONF")} de confianza`,
    choice.budgetChange===0?"Sin coste":`${formatSigned(choice.budgetChange," M")} de presupuesto`,
  ].join(" · ");
  const closingEffects=(choice:NexoCareerDecisionChoice)=>choice.condition
    ? `+${choice.conditionalBonus} puntos si ${choice.condition.toLowerCase()}. Si no, no recibes ese bonus.`
    : choice.sportingPointsChange!==0
      ? `${formatSigned(choice.sportingPointsChange," pts")} garantizados al cerrar la jornada.`
      : "No añade puntos deportivos al cerrar la jornada.";
  const missionTarget=(objective:NexoCareerObjective)=>{
    const target=objective.targetValue.toFixed(0);
    if(objective.metricKey==="originals")return `Alinea al menos ${target} jugadores originales`;
    if(objective.metricKey==="captain_points")return `Consigue ${target} puntos con tu capitán`;
    if(objective.metricKey==="new_signings")return `Alinea al menos ${target} fichajes nuevos`;
    if(objective.metricKey==="budget_floor")return `Conserva al menos ${target} M de presupuesto`;
    return `Consigue ${target} puntos con tu once`;
  };
  return <>
    <article className="career-hero"><div><p className="eyebrow">JORNADA {career.matchday} · {career.difficulty === "elite" ? "ÉLITE" : career.difficulty === "relaxed" ? "CANTERA" : "PROFESIONAL"}</p><h1>Que el club recuerde tu nombre.</h1><p>Conserva su identidad, mejora la plantilla y responde a una directiva que evaluará cada decisión.</p><div><button onClick={() => onArea("lineup")}>Preparar el once →</button><button onClick={() => onArea("market")}>Abrir mercado</button></div></div><section><span>{career.sportsClubName.split(/\s+/).map((word) => word[0]).slice(0,2).join("")}</span><p><small>CONFIANZA DIRECTIVA</small><strong>{workspace.boardConfidence}<i>/100</i></strong></p><div><i style={{width:`${workspace.boardConfidence}%`}} /></div></section></article>
    <div className="career-kpis"><article><small>PRESUPUESTO</small><strong>{workspace.budget.toFixed(1).replace(".", ",")} M</strong><span>Mercado exclusivo</span></article><article><small>PUNTOS DEPORTIVOS</small><strong>{career.sportingPoints}</strong><span>Temporada actual</span></article><article><small>IDENTIDAD</small><strong>{workspace.squad.filter((item) => item.isOriginal).length}/{workspace.squad.length}</strong><span>Jugadores originales</span></article><article><small>CONTRATO</small><strong>{tierLabel}</strong><span>{career.difficulty === "elite" ? "Máxima exigencia" : career.difficulty === "relaxed" ? "Margen amplio" : "Exigencia equilibrada"}</span></article></div>
    {latestReport&&<CareerMatchdayReportCard report={latestReport} onPrepare={()=>onArea("lineup")}/>} 
    <div className="career-main-grid">
      <article className="career-objectives">
        <p className="eyebrow">TU CONTRATO · {tierLabel.toUpperCase()}</p>
        <h2>Tu misión, en sencillo</h2>
        <p className="career-contract-intro">Cada jornada preparas el once. Cuando termina, el juego suma sus puntos y comprueba estos objetivos.</p>
        <div className="career-contract-summary">
          {matchdayObjective&&<section><span>1</span><p><small>MISIÓN DE ESTA JORNADA</small><strong>{missionTarget(matchdayObjective)}</strong><em>{matchdayObjective.description} · se comprueba al cerrar la J{career.matchday}</em></p></section>}
          {seasonObjective&&<section><span>2</span><p><small>TODA LA TEMPORADA</small><strong>Acumula {seasonObjective.targetValue.toFixed(0)} puntos</strong><em>Llevas {objectiveValue(seasonObjective).toFixed(0)} · progreso {progress}%</em></p></section>}
          {identityObjective&&<section><span>3</span><p><small>IDENTIDAD DEL CLUB</small><strong>Conserva al menos {identityObjective.targetValue.toFixed(0)} jugadores originales</strong><em>Ahora tienes {originalCount} en la plantilla</em></p></section>}
          {confidenceObjective&&<section><span>4</span><p><small>CONFIANZA DE LA DIRECTIVA</small><strong>Termina la temporada con {confidenceObjective.targetValue.toFixed(0)} o más</strong><em>Ahora tienes {workspace.boardConfidence}/100</em></p></section>}
        </div>
        <div className="career-contract-flow"><p><b>①</b><span><strong>Guarda tu once</strong><small>Elige 11 jugadores y un capitán.</small></span></p><p><b>②</b><span><strong>Se juega la jornada</strong><small>Tus futbolistas consiguen puntos reales.</small></span></p><p><b>③</b><span><strong>Se evalúa</strong><small>Ganas recompensas o baja la confianza.</small></span></p></div>
        <section className={`career-job-safety ${jobRisk}`}><header><div><small>SEGURIDAD DEL PUESTO</small><strong>{jobRiskLabel}</strong></div><b>{workspace.boardConfidence}/100 confianza</b></header><div className="career-confidence-meter"><i style={{left:`${dismissalThreshold}%`}}><span>Despido ≤ {dismissalThreshold}</span></i><b style={{width:`${workspace.boardConfidence}%`}} /></div><div className="career-failure-counter"><p><strong>Fallos consecutivos</strong><small>El contador vuelve a cero cuando completas la misión de una jornada.</small></p><span>{[0,1,2].map((index)=><i className={index<workspace.consecutiveFailures?"filled":""} key={index}>{index<workspace.consecutiveFailures?"×":index+1}</i>)}</span><b>{workspace.consecutiveFailures}/3</b></div><footer>{workspace.consecutiveFailures===0?`Tienes ${confidenceMargin} puntos de margen sobre el umbral y ningún fallo acumulado.`:`Necesitas completar la próxima misión para cortar la racha de fallos.`}</footer></section>
      </article>
      <article className="career-decision">
        <p className="eyebrow">DECISIÓN DE LA JORNADA</p><h2>{workspace.decisionPrompt?.title??"Sin dilema pendiente"}</h2><p>{workspace.decisionPrompt?.description??"La directiva no ha planteado una decisión para esta jornada."}</p>
        {decision ? <div className="career-decision-result"><span>✓</span><strong>{decision.choiceTitle}</strong><small>{decision.consequence}</small><div className="career-effect-pills"><b>{formatSigned(decision.reputationChange," REP")}</b><b>{formatSigned(decision.confidenceChange," CONF")}</b><b>{formatSigned(decision.budgetChange," M")}</b>{decision.sportingPointsChange!==0&&<b>{formatSigned(decision.sportingPointsChange," pts")}</b>}{decision.conditionalOriginalTarget&&<b>+{decision.conditionalSportingBonus} pts si alineas {decision.conditionalOriginalTarget} originales</b>}</div></div>
        : pendingChoice ? <div className="career-decision-confirm"><p className="eyebrow">ANTES DE CONFIRMAR</p><h3>{pendingChoice.title}</h3><span>{pendingChoice.summary}</span><div className="career-effect-list"><p><b>Ocurre ahora</b><strong>{immediateEffects(pendingChoice)}</strong></p><p><b>Al cerrar la jornada</b><strong>{closingEffects(pendingChoice)}</strong></p></div><small>Después de confirmar no podrás cambiar esta decisión durante la Jornada {career.matchday}.</small><footer><button disabled={busy} onClick={()=>setPendingChoice(null)}>Volver</button><button disabled={busy} onClick={()=>onDecision(pendingChoice)}>{busy?"Confirmando…":"Confirmar decisión"}</button></footer></div>
        : rules.weeklyDecisionEnabled&&workspace.decisionPrompt ? <div className="career-decision-options">{workspace.decisionPrompt.choices.map((choice)=><button disabled={busy} key={choice.key} onClick={()=>setPendingChoice(choice)}><strong>{choice.title}</strong><small>{choice.summary}</small><span className="career-choice-timing"><i><b>OCURRE AHORA</b>{immediateEffects(choice)}</i><i><b>AL CERRAR LA JORNADA</b>{closingEffects(choice)}</i></span><em>Ver y confirmar →</em></button>)}</div>
        : <div className="career-decision-result"><span>—</span><strong>Sin decisión esta jornada</strong><small>Administración ha desactivado los dilemas semanales.</small></div>}
        <footer>Solo eliges una opción. Sus efectos se guardan y no se pueden repetir.</footer>
      </article>
    </div>
    <CareerRankingPreview career={career} ranking={ranking} onOpen={onRanking}/>
    <section className="career-squad-preview"><div className="section-title"><div><p className="eyebrow">PLANTILLA ACTUAL</p><h2>La base de tu proyecto</h2><p>{workspace.squad.length} jugadores, con mercado individual propio.</p></div><button className="text-button" onClick={() => onArea("market")}>Gestionar plantilla →</button></div><div>{workspace.squad.slice(0,6).map((player)=><article key={player.id}><Avatar player={player}/><p><strong>{player.name}</strong><small>{player.position} · {player.value.toFixed(1).replace(".",",")} M</small></p><b>{player.isOriginal ? "ORIGINAL" : "FICHAJE"}</b></article>)}</div></section>
  </>;
}

function CareerLineupHistory({ career, workspace, rules, draft, selectedMatchday, catalog, onSelectMatchday, onDraftChange, onSave, notify }: { career: NexoCareer; workspace: NexoCareerWorkspace; rules: CareerRules; draft: NexoCareerLineup | null; selectedMatchday: number; catalog: CompetitionPlayer[]; onSelectMatchday: (matchday: number) => void; onDraftChange: (lineup: NexoCareerLineup) => void; onSave: (lineup: NexoCareerLineup) => Promise<void>; notify: (value: string) => void }) {
  const matchdays = Array.from(new Set([career.matchday, ...workspace.lineups.map((lineup) => lineup.matchday), ...workspace.reports.map((report) => report.matchday)])).sort((a, b) => b - a);
  const statusFor = (matchday: number) => {
    if (matchday === career.matchday) return "Abierta";
    if (workspace.reports.some((report) => report.matchday === matchday)) return "Cerrada";
    return "Bloqueada";
  };
  return <section className="career-lineup-history">
    <header><div><p className="eyebrow">ALINEACIONES DE LA TEMPORADA</p><h2>Consulta cada jornada</h2><p>La jornada actual se puede editar. Las anteriores conservan exactamente el once que utilizaste para puntuar.</p></div><nav aria-label="Jornadas de la Carrera">{matchdays.map((matchday) => <button className={selectedMatchday === matchday ? "active" : ""} key={matchday} onClick={() => onSelectMatchday(matchday)}><strong>J{matchday}</strong><small>{statusFor(matchday)}</small></button>)}</nav></header>
    {selectedMatchday === career.matchday
      ? <LineupEditor career={career} workspace={workspace} rules={rules} draft={draft} onDraftChange={onDraftChange} onSave={onSave} notify={notify} />
      : <HistoricalCareerLineup career={career} workspace={workspace} matchday={selectedMatchday} catalog={catalog} onCurrent={() => onSelectMatchday(career.matchday)} />}
  </section>;
}

function HistoricalCareerLineup({ career, workspace, matchday, catalog, onCurrent }: { career: NexoCareer; workspace: NexoCareerWorkspace; matchday: number; catalog: CompetitionPlayer[]; onCurrent: () => void }) {
  const lineup = workspace.lineups.find((item) => item.matchday === matchday);
  const report = workspace.reports.find((item) => item.matchday === matchday);
  const playerSource = new Map([...catalog, ...workspace.squad].map((player) => [player.id, player]));
  const displayPlayers = report?.players.length ? report.players : (lineup?.playerIds ?? []).map((id) => {
    const player = playerSource.get(id);
    return player ? { playerId: id, name: player.name, initials: player.initials, position: player.position, photoUrl: player.photoUrl, isCaptain: id === lineup?.captainId, basePoints: 0, multiplier: 1, finalPoints: 0 } : null;
  }).filter((player): player is NonNullable<typeof player> => player !== null);
  const formation = report?.formation ?? lineup?.formation ?? "4-4-2";
  const captain = displayPlayers.find((player) => player.isCaptain);
  const stateLabel = report ? "Cerrada" : "Bloqueada · puntos pendientes";

  if (!lineup && !report) return <article className="career-historical-empty"><span>J{matchday}</span><div><p className="eyebrow">JORNADA BLOQUEADA</p><h2>No se guardó una alineación</h2><p>Esta jornada queda en el historial, pero no existe un once válido asociado.</p></div><button onClick={onCurrent}>Preparar J{career.matchday} →</button></article>;

  return <section className="career-historical-lineup">
    <div className="league-section-heading"><div><p className="eyebrow">JORNADA {matchday} · HISTORIAL</p><h2>El once que quedó congelado</h2><p>{report ? "La jornada está cerrada y estos son sus puntos definitivos." : "El once ya no puede modificarse. Los puntos aparecerán cuando termine la jornada."}</p></div><button className="secondary-button" onClick={onCurrent}>Ir a la Jornada {career.matchday}</button></div>
    <div className="career-lineup-status"><span><small>FORMACIÓN</small><strong>{formation}</strong></span><span><small>JUGADORES</small><strong>{displayPlayers.length}/11</strong></span><span><small>CAPITÁN</small><strong>{captain?.name ?? "Sin capitán"}</strong></span><span><small>ESTADO</small><strong className={report ? "ok" : ""}>{stateLabel}</strong></span></div>
    <article className="pitch-card historical-pitch-card"><div className="pitch-header"><div><p className="eyebrow">TU ONCE · JORNADA {matchday}</p><h2>{formation}</h2></div><span className="saved-state">{report ? `${report.totalPoints.toFixed(0)} puntos` : "Esperando cierre"}</span></div><div className="football-pitch league-detail-pitch fantasy-draft-pitch"><div className="field-line center-line"/><div className="field-line center-circle"/>{(["DEL","MED","DEF","POR"] as PlayerPosition[]).map((position) => <div className="player-row" key={position}>{displayPlayers.filter((player) => player.position === position).map((player) => <div className="pitch-player lineup-player historical" key={player.playerId}><span>{player.photoUrl ? <img src={player.photoUrl} alt=""/> : player.initials}{player.isCaptain && <b>C</b>}</span><strong>{player.name}</strong><small>{report ? `${player.finalPoints.toFixed(0)} pts` : "Congelado"}</small></div>)}</div>)}</div></article>
  </section>;
}

function LineupEditor({ career, workspace, rules, draft, onDraftChange, onSave, notify }: { career: NexoCareer; workspace: NexoCareerWorkspace; rules: CareerRules; draft: NexoCareerLineup | null; onDraftChange: (lineup: NexoCareerLineup) => void; onSave: (lineup: NexoCareerLineup) => Promise<void>; notify: (value: string) => void }) {
  const saved = workspace.lineups.find((item) => item.matchday === career.matchday);
  const initial = draft ?? saved;
  const [formation,setFormation]=useState(initial?.formation??"4-4-2"); const [ids,setIds]=useState<string[]>(initial?.playerIds.filter((id)=>workspace.squad.some((player)=>player.id===id))??[]); const [captain,setCaptain]=useState(initial?.captainId??""); const [filter,setFilter]=useState<PlayerPosition|"Todos">("Todos"); const [saving,setSaving]=useState(false);
  useEffect(()=>{onDraftChange({matchday:career.matchday,formation,playerIds:ids,captainId:captain,savedAt:"draft"})},[formation,ids,captain]);
  const selected=workspace.squad.filter((player)=>ids.includes(player.id)); const originals=selected.filter((player)=>player.isOriginal).length; const valid=ids.length===11&&ids.includes(captain)&&originals>=rules.minimumOriginalLineup&&(Object.keys(formations[formation]) as PlayerPosition[]).every((position)=>selected.filter((player)=>player.position===position).length===formations[formation][position]);
  function changeFormation(next:string){const kept=(Object.keys(formations[next]) as PlayerPosition[]).flatMap((position)=>selected.filter((player)=>player.position===position).slice(0,formations[next][position]).map((player)=>player.id));setFormation(next);setIds(kept);if(!kept.includes(captain))setCaptain("")}
  function toggle(player:NexoCareerPlayer){if(ids.includes(player.id)){setIds(ids.filter((id)=>id!==player.id));if(captain===player.id)setCaptain("");return}if(selected.filter((item)=>item.position===player.position).length>=formations[formation][player.position]){notify(`Ya están completas las plazas de ${player.position}`);return}setIds([...ids,player.id])}
  async function submit(){if(!valid)return;setSaving(true);try{await onSave({matchday:career.matchday,formation,playerIds:ids,captainId:captain,savedAt:new Date().toISOString()})}catch(error){notify(error instanceof Error?error.message:"No se pudo guardar")}finally{setSaving(false)}}
  return <section className="career-lineup-editor"><div className="league-section-heading"><div><p className="eyebrow">JORNADA {career.matchday} · ONCE DE CARRERA</p><h2>Elige quién representa tu proyecto</h2><p>Solo puedes utilizar jugadores de tu plantilla. El servidor comprobará de nuevo todas las reglas.</p></div><button className="primary-button" disabled={!valid||saving} onClick={submit}>{saving?"Guardando…":saved?"Actualizar once":`${ids.length}/11 · Guardar`}</button></div><div className="career-lineup-status"><span><small>FORMACIÓN</small><strong>{formation}</strong></span><span><small>ORIGINALES</small><strong className={originals>=rules.minimumOriginalLineup?"ok":""}>{originals}/{rules.minimumOriginalLineup} mín.</strong></span><span><small>CAPITÁN</small><strong>{workspace.squad.find((item)=>item.id===captain)?.name??"Pendiente"}</strong></span><span><small>ESTADO</small><strong className={valid?"ok":""}>{valid?"Listo":"Incompleto"}</strong></span></div><div className="formation-picker career-formations"><small>FORMACIÓN</small>{Object.keys(formations).map((item)=><button className={formation===item?"active":""} key={item} onClick={()=>changeFormation(item)}>{item}</button>)}</div>
    <div className="career-lineup-grid"><article className="pitch-card"><div className="pitch-header"><div><p className="eyebrow">TU ONCE · {ids.length}/11</p><h2>{formation}</h2></div><span className="saved-state">Toca para quitar · elige capitán abajo</span></div><div className="football-pitch league-detail-pitch fantasy-draft-pitch"><div className="field-line center-line"/><div className="field-line center-circle"/>{(["DEL","MED","DEF","POR"] as PlayerPosition[]).map((position)=><div className="player-row" key={position}>{selected.filter((player)=>player.position===position).map((player)=><button className="pitch-player lineup-player" key={player.id} onClick={()=>toggle(player)}><span>{player.initials}{captain===player.id&&<b>C</b>}</span><strong>{player.name}</strong><small>{player.isOriginal?"Original":"Fichaje"}</small></button>)}{Array.from({length:Math.max(0,formations[formation][position]-selected.filter((player)=>player.position===position).length)},(_,index)=><span className="empty-pitch-slot" key={index}>+</span>)}</div>)}</div></article><aside className="career-squad-selector"><header><p className="eyebrow">PLANTILLA DISPONIBLE</p><h3>{workspace.squad.length} jugadores</h3><small>Selecciona once respetando las posiciones.</small></header><nav>{(["Todos","POR","DEF","MED","DEL"] as const).map((item)=><button className={filter===item?"active":""} key={item} onClick={()=>setFilter(item)}>{item}</button>)}</nav><div>{workspace.squad.filter((player)=>filter==="Todos"||player.position===filter).map((player)=>{const active=ids.includes(player.id);return <button className={active?"selected":""} key={player.id} onClick={()=>toggle(player)}><Avatar player={player}/><p><strong>{player.name}</strong><small>{player.position} · {player.club}</small></p><b>{player.isOriginal?"ORIGINAL":"FICHAJE"}</b><em>{active?"Quitar":"Alinear"}</em></button>})}</div></aside></div><div className="career-captain-row"><p><strong>Elige capitán</strong><small>Debe formar parte del once guardado.</small></p><div>{selected.map((player)=><button className={captain===player.id?"active":""} key={player.id} onClick={()=>setCaptain(player.id)}><Avatar player={player}/><span>{player.name}</span></button>)}</div></div></section>;
}

function CareerMarket({ career,workspace,rules,alignedPlayerIds,busy,onOperation }:{career:NexoCareer;workspace:NexoCareerWorkspace;rules:CareerRules;alignedPlayerIds:string[];busy:boolean;onOperation:(type:"buy"|"sell",player:NexoCareerPlayer)=>void}){
  const [tab,setTab]=useState<"buy"|"sell">("buy");const [query,setQuery]=useState("");const [position,setPosition]=useState<PlayerPosition|"Todos">("Todos");const originals=workspace.squad.filter((item)=>item.isOriginal).length;const source=tab==="buy"?workspace.market:workspace.squad;const visible=useMemo(()=>source.filter((player)=>(position==="Todos"||player.position===position)&&`${player.name} ${player.club}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es"))),[source,position,query]);
  return <section className="career-market"><header><div><p className="eyebrow">MERCADO INDIVIDUAL · JORNADA {career.matchday}</p><h2>Construye tu propia versión del club</h2><p>Las operaciones son inmediatas y solo afectan a esta Carrera.</p></div><article><small>SALDO DISPONIBLE</small><strong>{workspace.budget.toFixed(1).replace(".",",")} M</strong><span>{workspace.squad.length}/25 jugadores</span></article></header><div className="career-market-tabs"><button className={tab==="buy"?"active":""} onClick={()=>setTab("buy")}>Fichar <b>{workspace.market.length}</b></button><button className={tab==="sell"?"active":""} onClick={()=>setTab("sell")}>Mi plantilla <b>{workspace.squad.length}</b></button></div><div className="career-market-tools"><label><span>⌕</span><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Buscar jugador o club"/></label><nav>{(["Todos","POR","DEF","MED","DEL"] as const).map((item)=><button className={position===item?"active":""} key={item} onClick={()=>setPosition(item)}>{item}</button>)}</nav></div><div className="career-market-list">{visible.map((player)=>{const aligned=tab==="sell"&&alignedPlayerIds.includes(player.id);const unavailable=tab==="buy"?(player.value>workspace.budget||workspace.squad.length>=25):(aligned||workspace.squad.length<=11||(player.isOriginal&&originals<=rules.minimumOriginalSquad));return <article className={aligned?"aligned":""} key={player.id}><Avatar player={player}/><p><strong>{player.name}</strong><small>{player.position} · {player.club}{player.isOriginal?" · Original":""}</small>{aligned&&<b className="career-aligned-badge">ALINEADO</b>}</p><span><small>VALOR</small><strong>{player.value.toFixed(1).replace(".",",")} M</strong></span><button disabled={busy||unavailable} onClick={()=>onOperation(tab,player)}>{tab==="buy"?(unavailable?"No disponible":"Fichar"):(aligned?"En el once":unavailable?"Protegido":"Vender")}</button></article>})}</div><article className="career-market-note"><span>✓</span><p><strong>Operaciones protegidas por el servidor</strong><small>Se comprueban saldo, competición, límite de plantilla, identidad y alineación guardada justo antes de confirmar.</small></p></article></section>;
}
