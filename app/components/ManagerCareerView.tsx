"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CareerContractOverview, CareerHeroOverview, type CareerCalendarWindow } from "./CareerContractOverview";
import type { CompetitionName, PlayerPosition } from "../data";
import type { CompetitionPlayer } from "../data/competition-players";
import type { MatchFixture } from "../services/nexo-calendar";
import { buyNexoCareerPlayer, delegateNexoCareerMatchday, loadNexoCareerRanking, loadNexoCareerWorkspace, markNexoCareerReportViewed, resolveNexoCareerCatalogIncident, saveNexoCareerDecision, saveNexoCareerInterludeDecision, saveNexoCareerInterludePlan, saveNexoCareerInterludeProject, saveNexoCareerInterludeStory, saveNexoCareerLineup, sellNexoCareerPlayer, type NexoCareer, type NexoCareerCatalogIncident, type NexoCareerCatalogIncidentChoice, type NexoCareerDecision, type NexoCareerDecisionChoice, type NexoCareerDecisionPrompt, type NexoCareerDelegationPlan, type NexoCareerInterlude, type NexoCareerInterludeChoice, type NexoCareerLineup, type NexoCareerMatchdayReport, type NexoCareerObjective, type NexoCareerPlayer, type NexoCareerRanking, type NexoCareerRankingRow, type NexoCareerWorkspace } from "../services/nexo-career";
import { CareerInterludeProgram } from "./CareerInterludeProgram";
import { CareerInterludeReportCard } from "./CareerInterludeReport";
import type { NexoCareerInterludeReport } from "../services/nexo-career";

export type CareerRules = { minimumOriginalSquad: number; minimumOriginalLineup: number; weeklyDecisionEnabled: boolean; dismissalConfidenceThreshold: number; sameClubRankingEnabled: boolean; delegationEnabled: boolean };
type Area = "overview" | "lineup" | "market" | "history";
const formations: Record<string, Record<PlayerPosition, number>> = {
  "4-4-2": { POR: 1, DEF: 4, MED: 4, DEL: 2 }, "4-3-3": { POR: 1, DEF: 4, MED: 3, DEL: 3 }, "3-4-3": { POR: 1, DEF: 3, MED: 4, DEL: 3 }, "3-5-2": { POR: 1, DEF: 3, MED: 5, DEL: 2 }, "5-3-2": { POR: 1, DEF: 5, MED: 3, DEL: 2 },
};

function Avatar({ player, children }: { player: NexoCareerPlayer; children?: ReactNode }) {
  return <span className="career-player-avatar">{player.photoUrl ? <img src={player.photoUrl} alt="" loading="lazy" /> : player.initials}{children}</span>;
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
  return { budget: career.budget, matchday: career.matchday, boardConfidence: 60, consecutiveFailures: 0, contractTier: "stability", status: career.status, squad, market, lineups: [], decisions: [], objectives, events: [], incidents: [], reports: [], interludeReports:[], delegation:{enabled:true,eligible:true,used:0,baseMaximum:5,bonusUses:0,maximum:5,remaining:5,cooldownMatchdays:3,nextAvailableMatchday:career.matchday,recommended:false,recommendationReasons:[],plans:[{key:"close_ranks",title:"Cerrar filas",description:"Recupera respaldo inmediato y reduce una mala racha.",cost:.5,confidenceChange:6,failuresReduced:1},{key:"tactical",title:"Golpe táctico",description:"Once automático con vicecapitán y suplencias por ausencia.",cost:.5,confidenceChange:0,failuresReduced:0},{key:"academy",title:"Proyecto de cantera",description:"Prioriza y potencia a los jugadores originales.",cost:.75,confidenceChange:0,failuresReduced:0,pointsMultiplier:1.1,identityRewardMultiplier:2}]}, decisionPrompt };
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
  const [delegationOpen,setDelegationOpen]=useState(false);

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
  useEffect(()=>{
    if(!backendEnabled||!career)return;
    const check=()=>{if(document.visibilityState==="visible")void refresh()};
    const timer=window.setInterval(check,60000);
    document.addEventListener("visibilitychange",check);
    window.addEventListener("focus",check);
    return()=>{window.clearInterval(timer);document.removeEventListener("visibilitychange",check);window.removeEventListener("focus",check)};
  },[backendEnabled,career?.id]);
  if (!career) return <section className="career-empty-page"><span>M</span><p className="eyebrow">CARRERA DE MÁNAGER</p><h1>Tu historia aún no ha empezado</h1><p>Elige un club real y afronta una temporada de objetivos, decisiones y reputación.</p><button className="primary-button" onClick={onNewCareer}>Elegir mi club</button></section>;
  const state = workspace ?? demoWorkspace(career, players);
  if (state.status === "dismissed") return <section className="manager-career-page dismissed-career-page"><header className="career-topline"><button className="career-topline-action back" onClick={onBack}><span>←</span>Volver a Clubes</button><p><span>CARRERA DE MÁNAGER</span><strong>{career.sportsClubName}</strong><small>{career.seasonLabel} · Carrera finalizada</small></p><button className="career-topline-action new" onClick={onNewCareer}><span>＋</span>Nueva carrera</button></header><DismissedCareerView career={career} workspace={state} rules={rules} ranking={ranking} onRanking={()=>setRankingOpen(true)} onBack={onBack} onNewCareer={onNewCareer}/>{rankingOpen&&ranking&&<CareerRankingDialog career={career} ranking={ranking} onClose={()=>setRankingOpen(false)}/>}</section>;
  const currentDecision = state.decisions.find((item) => item.matchday === career.matchday);
  const pendingIncident = state.incidents.find((item) => item.status === "pending");
  const competitionFixtures=fixtures.filter((fixture)=>fixture.competition===career.competition&&fixture.status!=="cancelled"&&fixture.kickoffAt);
  const currentRoundFixtures=competitionFixtures.filter((fixture)=>fixture.matchday===career.matchday).sort((a,b)=>new Date(a.kickoffAt!).getTime()-new Date(b.kickoffAt!).getTime());
  const nextRoundMatchday=Math.min(...competitionFixtures.filter((fixture)=>fixture.matchday>career.matchday).map((fixture)=>fixture.matchday));
  const nextRoundFixtures=Number.isFinite(nextRoundMatchday)?competitionFixtures.filter((fixture)=>fixture.matchday===nextRoundMatchday).sort((a,b)=>new Date(a.kickoffAt!).getTime()-new Date(b.kickoffAt!).getTime()):[];
  const calendarWindow:CareerCalendarWindow={currentStartAt:currentRoundFixtures[0]?.kickoffAt,currentEndAt:currentRoundFixtures.at(-1)?.kickoffAt,nextMatchday:Number.isFinite(nextRoundMatchday)?nextRoundMatchday:undefined,nextStartAt:nextRoundFixtures[0]?.kickoffAt};
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

  async function resolveIncident(incident: NexoCareerCatalogIncident, choice: NexoCareerCatalogIncidentChoice) {
    if (busy) return;
    setBusy(true);
    try {
      if (backendEnabled) {
        await resolveNexoCareerCatalogIncident(incident.id, choice.key);
        await Promise.all([refresh(), onCareerChanged()]);
      }
      notify(`${choice.title}: ${choice.budgetCredit.toFixed(2).replace(".", ",")} M añadidos al presupuesto`);
    } catch (error) { notify(error instanceof Error ? error.message : "No se ha podido resolver la salida"); }
    finally { setBusy(false); }
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
    setRevealReport(null);setArea(next==="lineup"?"lineup":"history");
  }

  async function delegate(plan:NexoCareerDelegationPlan){
    if(busy)return;setBusy(true);
    try{if(backendEnabled){await delegateNexoCareerMatchday(career!.id,plan.key);await Promise.all([refresh(),onCareerChanged()]);}notify(`${plan.title} activado para la Jornada ${career!.matchday}`);setDelegationOpen(false);setLineupDraft(null);}
    catch(error){notify(error instanceof Error?error.message:"No se ha podido delegar la jornada")}finally{setBusy(false)}
  }

  async function decideInterlude(choice:NexoCareerInterludeChoice){
    if(busy||!state.interlude)return;
    setBusy(true);
    try{
      if(backendEnabled){
        await saveNexoCareerInterludeDecision(career!.id,state.interlude.id,choice.key);
        await Promise.all([refresh(),onCareerChanged()]);
      }
      notify(`${choice.title}: plan de interludio confirmado`);
    }catch(error){notify(error instanceof Error?error.message:"No se ha podido guardar el plan del interludio")}
    finally{setBusy(false)}
  }

  return <section className="manager-career-page">
    <header className="career-topline"><button className="career-topline-action back" onClick={area === "overview" ? onBack : () => setArea("overview")}><span>←</span>{area === "overview" ? "Volver a Clubes" : "Volver al resumen"}</button><p><span>CARRERA DE MÁNAGER</span><strong>{career.sportsClubName}</strong><small>{career.seasonLabel} · Jornada {career.matchday}</small></p><button className="career-topline-action new" onClick={onNewCareer}><span>＋</span>Nueva carrera</button></header>
    <nav className="career-area-tabs"><button className={area === "overview" ? "active" : ""} onClick={() => setArea("overview")}>Resumen</button><button disabled={!!pendingIncident} className={area === "lineup" ? "active" : ""} onClick={() => setArea("lineup")}>Mi once{pendingIncident?" · pendiente":""}</button><button disabled={!!pendingIncident||!!state.delegation.current} className={area === "market" ? "active" : ""} onClick={() => setArea("market")}>Mercado{state.delegation.current?" · delegado":pendingIncident?" · pendiente":""}</button><button className={area === "history" ? "active" : ""} onClick={() => setArea("history")}>Evolución <b>{state.reports.length+state.interludeReports.length}</b></button></nav>
    {loading ? <div className="career-workspace-loading"><strong>Preparando tu despacho…</strong><span>Cargando plantilla, once, mercado e historial.</span></div> : area === "lineup" ? <CareerLineupHistory career={career} workspace={state} rules={rules} draft={lineupDraft} selectedMatchday={selectedLineupMatchday} catalog={players[career.competition]} onSelectMatchday={setSelectedLineupMatchday} onDraftChange={setLineupDraft} onSave={saveLineup} notify={notify} /> : area === "market" ? <CareerMarket career={career} workspace={state} rules={rules} alignedPlayerIds={alignedPlayerIds} busy={busy} onOperation={operate} /> : area === "history" ? <CareerSeasonHistory career={career} reports={state.reports} interludeReports={state.interludeReports} onPrepare={()=>setArea("lineup")}/> : <CareerOverview career={career} workspace={state} calendar={calendarWindow} rules={rules} decision={currentDecision} pendingIncident={pendingIncident} ranking={ranking} busy={busy} onArea={setArea} onDecision={decide} onIncident={resolveIncident} onRanking={()=>setRankingOpen(true)} onDelegate={()=>setDelegationOpen(true)} />}
    {rankingOpen&&ranking&&<CareerRankingDialog career={career} ranking={ranking} onClose={()=>setRankingOpen(false)}/>} 
    {revealReport&&<CareerMatchdayReveal career={career} report={revealReport} onClose={closeReveal}/>} 
    {delegationOpen&&<CareerDelegationDialog workspace={state} busy={busy} onSelect={delegate} onClose={()=>setDelegationOpen(false)}/>}
  </section>;
}

function CareerDelegationDialog({workspace,busy,onSelect,onClose}:{workspace:NexoCareerWorkspace;busy:boolean;onSelect:(plan:NexoCareerDelegationPlan)=>void;onClose:()=>void}){
  const [selected,setSelected]=useState<NexoCareerDelegationPlan|null>(null);
  return <div className="dialog-backdrop"><section className="career-delegation-dialog" role="dialog" aria-modal="true"><header><div><p className="eyebrow">DELEGAR UNA JORNADA</p><h2>Elige qué debe proteger tu segundo entrenador</h2><p>Generará un once válido y lo dejará bloqueado. No podrás usar el mercado ni responder al dilema semanal.</p></div><button onClick={onClose}>×</button></header>{selected?<article className="career-delegation-confirm"><span>2º</span><p className="eyebrow">ANTES DE CONFIRMAR</p><h3>{selected.title}</h3><p>{selected.description}</p><div><b>-{selected.cost.toFixed(2).replace(".",",")} M</b>{selected.confidenceChange>0&&<b>+{selected.confidenceChange} confianza</b>}{selected.failuresReduced>0&&<b>-{selected.failuresReduced} fallo acumulado</b>}{selected.pointsMultiplier&&<b>×{selected.pointsMultiplier.toFixed(2)} puntos de originales</b>}{selected.identityRewardMultiplier&&<b>×{selected.identityRewardMultiplier.toFixed(0)} recompensa de identidad</b>}</div><ul><li>El once se genera y guarda en el servidor.</li><li>No podrás cambiar jugadores, fichar, vender ni elegir una decisión semanal.</li><li>Consume 1 de {workspace.delegation.maximum} usos y activa {workspace.delegation.cooldownMatchdays} jornadas de espera.</li></ul><footer><button disabled={busy} onClick={()=>setSelected(null)}>Volver</button><button disabled={busy||workspace.budget<selected.cost} onClick={()=>onSelect(selected)}>{busy?"Delegando…":workspace.budget<selected.cost?"Saldo insuficiente":"Confirmar delegación"}</button></footer></article>:<><div className="career-delegation-usage"><span><small>USOS DISPONIBLES</small><strong>{workspace.delegation.remaining}/{workspace.delegation.maximum}</strong>{workspace.delegation.bonusUses>0&&<em>+{workspace.delegation.bonusUses} por objetivos</em>}</span><p>Puedes desbloquear hasta dos usos adicionales cumpliendo objetivos importantes. Si terminas sin delegar, obtendrás el logro «Siempre al mando».</p></div><div className="career-delegation-plans">{workspace.delegation.plans.map((plan)=><button key={plan.key} onClick={()=>setSelected(plan)}><span>{plan.key==="close_ranks"?"+":plan.key==="tactical"?"XI":"C"}</span><small>{plan.key==="close_ranks"?"CONTROL DE CRISIS":plan.key==="tactical"?"SEGURIDAD DEPORTIVA":"IDENTIDAD DEL CLUB"}</small><strong>{plan.title}</strong><p>{plan.description}</p><footer><b>{plan.cost.toFixed(2).replace(".",",")} M</b><em>Ver consecuencias →</em></footer></button>)}</div>{!workspace.delegation.eligible&&<p className="career-delegation-blocked">{workspace.delegation.blockingReason}</p>}</>}</section></div>
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

export function CareerSeasonHistory({career,reports,interludeReports=[],onPrepare}:{career:NexoCareer;reports:NexoCareerMatchdayReport[];interludeReports?:NexoCareerInterludeReport[];onPrepare:()=>void}){
  const ordered=[...reports].sort((a,b)=>a.matchday-b.matchday);
  const latest=ordered.at(-1);
  const total=ordered.reduce((sum,report)=>sum+report.totalPoints,0);
  const average=ordered.length?total/ordered.length:0;
  const best=ordered.reduce<NexoCareerMatchdayReport|null>((current,report)=>!current||report.totalPoints>current.totalPoints?report:current,null);
  const missions=ordered.filter((report)=>report.mission?.status==="completed").length;
  const maxPoints=Math.max(1,...ordered.map((report)=>report.totalPoints));
  return <section className="career-season-history">
    <header><div><p className="eyebrow">TEMPORADA {career.seasonLabel} · EVOLUCIÓN</p><h1>Tu historia, jornada a jornada</h1><p>Cada cierre conserva el once, los puntos, la decisión y sus consecuencias. Ningún cambio posterior altera estas actas.</p></div><span><small>JORNADAS CERRADAS</small><strong>{ordered.length}</strong><em>de la temporada</em></span></header>
    {!ordered.length?<article className="career-history-empty"><span>J1</span><div><h2>Aún no hay jornadas cerradas</h2><p>El primer informe aparecerá automáticamente cuando finalice y se procese tu primera jornada.</p></div><button onClick={onPrepare}>Preparar mi once →</button></article>:<>
      <div className="career-history-kpis"><article><small>PUNTOS TOTALES</small><strong>{total.toFixed(0)}</strong><span>{average.toFixed(1).replace(".",",")} de media</span></article><article><small>MEJOR JORNADA</small><strong>J{best?.matchday}</strong><span>{best?.totalPoints.toFixed(0)} puntos</span></article><article><small>MISIONES CUMPLIDAS</small><strong>{missions}/{ordered.length}</strong><span>{Math.round(missions/ordered.length*100)}% de éxito</span></article><article><small>CONFIANZA ACTUAL</small><strong>{latest?.confidenceAfter}/100</strong><span>{latest&&latest.confidenceAfter>=latest.confidenceBefore?"Tendencia positiva":"Necesita reacción"}</span></article></div>
      <section className="career-history-chart"><header><div><p className="eyebrow">RENDIMIENTO DEPORTIVO</p><h2>Puntos por jornada</h2></div><p><b>●</b> Puntos del once <span>La altura permite comparar tu regularidad.</span></p></header><div>{ordered.map((report)=><article key={report.matchday}><span><b>{report.totalPoints.toFixed(0)}</b><i style={{height:`${Math.max(8,report.totalPoints/maxPoints*100)}%`}}/></span><strong>J{report.matchday}</strong><small>{report.mission?.status==="completed"?"✓":"×"}</small></article>)}</div></section>
      <section className="career-history-trends"><article><small>CONFIANZA</small><div>{ordered.map((report)=><span key={report.matchday} style={{height:`${Math.max(5,report.confidenceAfter)}%`}} title={`J${report.matchday}: ${report.confidenceAfter}`}/>)}</div><strong>{ordered[0].confidenceBefore} → {latest?.confidenceAfter}</strong></article><article><small>REPUTACIÓN</small><div>{ordered.map((report)=><span key={report.matchday} style={{height:`${Math.max(5,report.reputationAfter)}%`}} title={`J${report.matchday}: ${report.reputationAfter}`}/>)}</div><strong>{ordered[0].reputationBefore} → {latest?.reputationAfter}</strong></article><article><small>PRESUPUESTO</small><div>{ordered.map((report)=>{const max=Math.max(1,...ordered.map((item)=>item.budgetAfter));return <span key={report.matchday} style={{height:`${Math.max(5,report.budgetAfter/max*100)}%`}} title={`J${report.matchday}: ${report.budgetAfter} M`}/>})}</div><strong>{ordered[0].budgetBefore.toFixed(1).replace(".",",")} → {latest?.budgetAfter.toFixed(1).replace(".",",")} M</strong></article></section>
      {!!interludeReports.length&&<div className="career-history-interludes"><div className="section-title"><div><p className="eyebrow">DESCANSOS DE LA TEMPORADA</p><h2>Informes de interludio</h2><p>Los planes y decisiones tomadas entre jornadas quedan guardados para siempre.</p></div></div>{[...interludeReports].reverse().map((report)=><CareerInterludeReportCard key={report.id} report={report} compact/>)}</div>}
      <div className="career-history-reports"><div className="section-title"><div><p className="eyebrow">ACTAS DE LA TEMPORADA</p><h2>Todos los informes</h2><p>Abre cualquier jornada para revisar cada jugador y cada consecuencia.</p></div></div>{[...ordered].reverse().map((report)=><CareerMatchdayReportCard key={report.matchday} report={report} onPrepare={onPrepare} compact/>)}</div>
    </>}
  </section>;
}

export function CareerMatchdayReportCard({report,onPrepare,compact=false}:{report:NexoCareerMatchdayReport;onPrepare:()=>void;compact?:boolean}){
  const [expanded,setExpanded]=useState(false);
  const missionPassed=report.mission?.status==="completed";
  const confidenceChange=report.confidenceAfter-report.confidenceBefore;
  const reputationChange=report.reputationAfter-report.reputationBefore;
  const budgetChange=report.budgetAfter-report.budgetBefore;
  const signed=(value:number,suffix="")=>`${value>0?"+":""}${value.toFixed(suffix===" M"?2:0).replace(".",",")}${suffix}`;
  const rankingMove=report.rankingPosition&&report.previousRankingPosition
    ? report.previousRankingPosition-report.rankingPosition
    : undefined;
  return <section className={`career-matchday-report ${missionPassed?"passed":"failed"}${compact?" compact":""}`}>
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
    <footer><button onClick={()=>setExpanded(!expanded)}>{expanded?"Ocultar desglose":"Ver informe completo"}</button>{!compact&&<button onClick={onPrepare}>Preparar Jornada {report.matchday+1} →</button>}</footer>
  </section>;
}

function CareerCatalogIncidentCard({ incident, busy, onResolve }: { incident: NexoCareerCatalogIncident; busy: boolean; onResolve: (incident: NexoCareerCatalogIncident, choice: NexoCareerCatalogIncidentChoice) => void }) {
  const [selected,setSelected]=useState<NexoCareerCatalogIncidentChoice|null>(null);
  const reason=incident.changeType==="club_exit"?"ha fichado por otro club":incident.changeType==="competition_change"?"ha cambiado de competición":"ha salido de la competición";
  return <section className="career-catalog-incident">
    <header><div className="career-incident-player">{incident.photoUrl?<img src={incident.photoUrl} alt=""/>:<span>{incident.initials}</span>}<p><small>CAMBIO REAL EN LA PLANTILLA</small><strong>{incident.playerName}</strong><em>{incident.position} · {reason}</em></p></div><b>DECISIÓN PENDIENTE</b></header>
    <div className="career-incident-message"><span>!</span><p><strong>El mercado real cambia tu historia</strong><small>Su valor queda congelado en {incident.frozenMarketValue.toFixed(2).replace(".",",")} M. El borrador abierto se ha retirado si lo incluía; las jornadas cerradas permanecen intactas.</small></p></div>
    {selected?<div className="career-incident-confirm"><p className="eyebrow">ANTES DE CONFIRMAR</p><h3>{selected.title}</h3><p>{selected.summary}</p><div><span><small>PRESUPUESTO</small><strong>+{selected.budgetCredit.toFixed(2).replace(".",",")} M</strong></span><span><small>REPUTACIÓN</small><strong className={selected.reputationChange<0?"negative":""}>{selected.reputationChange>0?"+":""}{selected.reputationChange}</strong></span><span><small>CONFIANZA</small><strong>+{selected.confidenceChange}</strong></span></div><small>Al confirmar, {incident.playerName} saldrá definitivamente de esta Carrera y tendrás que completar de nuevo el once si fuera necesario.</small><footer><button disabled={busy} onClick={()=>setSelected(null)}>Volver</button><button disabled={busy} onClick={()=>onResolve(incident,selected)}>{busy?"Aplicando…":"Confirmar respuesta"}</button></footer></div>
    :<div className="career-incident-options">{incident.choices.map((choice)=><button key={choice.key} disabled={busy} onClick={()=>setSelected(choice)}><small>{choice.key==="reinvest"?"PLAN DEPORTIVO":"PLAN DE CLUB"}</small><strong>{choice.title}</strong><p>{choice.summary}</p><span><b>+{choice.budgetCredit.toFixed(2).replace(".",",")} M</b><b className={choice.reputationChange<0?"negative":""}>{choice.reputationChange>0?"+":""}{choice.reputationChange} REP</b><b>+{choice.confidenceChange} CONF</b></span><em>Revisar consecuencias →</em></button>)}</div>}
  </section>;
}

function CareerOverview({ career, workspace, calendar, rules, decision, pendingIncident, ranking, busy, onArea, onDecision, onIncident, onRanking, onDelegate }: { career: NexoCareer; workspace: NexoCareerWorkspace; calendar: CareerCalendarWindow; rules: CareerRules; decision?: NexoCareerDecision; pendingIncident?: NexoCareerCatalogIncident; ranking: NexoCareerRanking|null; busy: boolean; onArea: (area: Area) => void; onDecision: (choice: NexoCareerDecisionChoice) => void; onIncident: (incident: NexoCareerCatalogIncident, choice: NexoCareerCatalogIncidentChoice) => void; onRanking: () => void; onDelegate: () => void }) {
  const [pendingChoice,setPendingChoice]=useState<NexoCareerDecisionChoice|null>(null);
  const originalCount=workspace.squad.filter((item)=>item.isOriginal).length;
  const tierLabel=workspace.contractTier==="title"?"Luchar por el título":workspace.contractTier==="europe"?"Competir arriba":"Construir y consolidar";
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
  return <>
    <CareerHeroOverview matchday={career.matchday} difficulty={career.difficulty} clubName={career.sportsClubName} confidence={workspace.boardConfidence} budget={workspace.budget} sportingPoints={career.sportingPoints} originalCount={originalCount} squadCount={workspace.squad.length} tierLabel={tierLabel} delegated={!!workspace.delegation.current} onLineup={()=>onArea("lineup")} onMarket={()=>onArea("market")} onDelegate={rules.delegationEnabled&&!workspace.delegation.current?onDelegate:undefined} delegateDisabled={!workspace.delegation.eligible} calendar={calendar}/>
    {workspace.interlude&&<CareerInterludeCard careerId={career.id} interlude={workspace.interlude} squad={workspace.squad}/>}
    {!workspace.interlude&&workspace.interludeReports.at(-1)&&<CareerInterludeReportCard report={workspace.interludeReports.at(-1)!}/>}
    {latestReport&&<CareerMatchdayReportCard report={latestReport} onPrepare={()=>onArea("lineup")}/>} 
    {pendingIncident&&<CareerCatalogIncidentCard key={pendingIncident.id} incident={pendingIncident} busy={busy} onResolve={onIncident}/>}
    {workspace.delegation.current&&<section className="career-delegation-active"><span>2º</span><div><p className="eyebrow">SEGUNDO ENTRENADOR · JORNADA {career.matchday}</p><h2>{workspace.delegation.plans.find((plan)=>plan.key===workspace.delegation.current?.plan)?.title}</h2><p>El servidor ha fijado un {workspace.delegation.current.formation}. Puedes revisar el once, pero no editarlo, operar en el mercado ni tomar la decisión semanal.</p></div><button onClick={()=>onArea("lineup")}>Revisar once →</button></section>}
    {!workspace.delegation.current&&workspace.delegation.recommended&&<section className="career-delegation-recommended"><span>!</span><div><p className="eyebrow">LA DIRECTIVA TE OFRECE APOYO</p><h2>Puede ser un buen momento para delegar</h2><p>{workspace.delegation.recommendationReasons.join(" · ")}</p></div><button disabled={!workspace.delegation.eligible} onClick={onDelegate}>Ver planes →</button></section>}
    <div className="career-main-grid">
      <CareerContractOverview tierLabel={tierLabel} matchday={career.matchday} objectives={workspace.objectives} originalCount={originalCount} confidence={workspace.boardConfidence} consecutiveFailures={workspace.consecutiveFailures} dismissalThreshold={rules.dismissalConfidenceThreshold} sportingPoints={career.sportingPoints}/>
      <article className="career-decision">
        <p className="eyebrow">DECISIÓN DE LA JORNADA</p><h2>{workspace.decisionPrompt?.title??"Sin dilema pendiente"}</h2><p>{workspace.decisionPrompt?.description??"La directiva no ha planteado una decisión para esta jornada."}</p>
        {workspace.delegation.current?<div className="career-decision-result"><span>2º</span><strong>Decide el segundo entrenador</strong><small>Al delegar renuncias al dilema semanal. El plan elegido ocupa su lugar durante esta jornada.</small></div>
        : decision ? <div className="career-decision-result"><span>✓</span><strong>{decision.choiceTitle}</strong><small>{decision.consequence}</small><div className="career-effect-pills"><b>{formatSigned(decision.reputationChange," REP")}</b><b>{formatSigned(decision.confidenceChange," CONF")}</b><b>{formatSigned(decision.budgetChange," M")}</b>{decision.sportingPointsChange!==0&&<b>{formatSigned(decision.sportingPointsChange," pts")}</b>}{decision.conditionalOriginalTarget&&<b>+{decision.conditionalSportingBonus} pts si alineas {decision.conditionalOriginalTarget} originales</b>}</div></div>
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

function CareerInterludeCard({careerId,interlude,squad}:{careerId:string;interlude:NexoCareerInterlude;squad:NexoCareerPlayer[]}){
  const [value,setValue]=useState(interlude);const [saving,setSaving]=useState(false);
  if(value.status==="cancelled")return null;
  const run=async(task:()=>Promise<NexoCareerInterlude>)=>{setSaving(true);try{setValue(await task())}finally{setSaving(false)}};
  return <CareerInterludeProgram value={value} busy={saving} squad={squad} onPlan={(plan)=>run(()=>saveNexoCareerInterludePlan(careerId,value.id,plan))} onStory={(chapter,choice,configuration)=>run(()=>saveNexoCareerInterludeStory(careerId,value.id,chapter,choice,configuration))}/>;
}

function LegacyCareerInterludeCard({careerId,interlude}:{careerId:string;interlude:NexoCareerInterlude}){
  const [selected,setSelected]=useState<NexoCareerInterludeChoice|null>(null);
  const [saving,setSaving]=useState(false);
  const [todayDecision,setTodayDecision]=useState(interlude.todayDecision);
  const [actions,setActions]=useState(interlude.actions??(interlude.decision?[interlude.decision]:[]));
  const remaining=Math.max(0,new Date(interlude.endsAt).getTime()-Date.now());
  const days=Math.floor(remaining/86400000);const hours=Math.floor((remaining%86400000)/3600000);
  async function confirm(choice:NexoCareerInterludeChoice){setSaving(true);try{const next={plan:choice.key,title:choice.title,consequence:`${choice.immediate}. ${choice.returnEffect}.`,confidenceChange:choice.confidenceChange,reputationChange:choice.reputationChange,budgetChange:choice.budgetChange,failuresReduced:choice.key==="recovery"?1:0,nextEffect:choice.key==="tactical"?{type:"failure_protection"}:choice.key==="academy"?{type:"academy_reputation"}:{},decidedAt:new Date().toISOString(),actionDate:new Date().toISOString().slice(0,10)};await saveNexoCareerInterludeDecision(careerId,interlude.id,choice.key);setTodayDecision(next);setActions((current)=>[...current,next]);setSelected(null)}finally{setSaving(false)}}
  if(interlude.status==="cancelled")return null;
  return <section className={`career-interlude ${interlude.status}`}><header><span>II</span><div><p className="eyebrow">INTERLUDIO DE TEMPORADA · ENTRE J{interlude.fromMatchday} Y J{interlude.toMatchday}</p><h2>{interlude.title}</h2><p>Durante el descanso puedes realizar una actividad cada día. {interlude.preparationDays??3} días antes del siguiente partido se cerrarán las actividades y se abrirá la preparación de la J{interlude.toMatchday}.</p></div><aside><small>{interlude.phase==="preparation"?"JORNADA ABIERTA":"DÍAS DE ACTIVIDAD"}</small><strong>{interlude.phase==="preparation"?`J${interlude.toMatchday}`:`${interlude.remainingActionDays??Math.max(0,days-(interlude.preparationDays??3))}`}</strong><em>{new Date(interlude.preparationOpensAt??interlude.endsAt).toLocaleDateString("es-ES",{day:"numeric",month:"short"})}</em></aside></header>
    {interlude.status==="pending"?<div className="career-interlude-pending"><b>Esperando confirmación</b><span>Administración revisará el calendario antes de activar las decisiones.</span></div>
    :interlude.phase==="preparation"?<article className="career-interlude-result"><span>XI</span><div><small>SE ABRE LA SIGUIENTE JORNADA</small><strong>Ya puedes preparar la J{interlude.toMatchday}</strong><p>Las actividades han terminado. Conservas sus efectos y puedes trabajar en el once con normalidad.</p></div><aside><b>{actions.length} actividades realizadas</b></aside></article>
    :todayDecision?<article className="career-interlude-result"><span>✓</span><div><small>ACTIVIDAD DE HOY COMPLETADA</small><strong>{todayDecision.title}</strong><p>{todayDecision.consequence}</p><em>Vuelve mañana: se desbloqueará una nueva decisión mientras continúe el interludio.</em></div><aside>{todayDecision.confidenceChange!==0&&<b>{todayDecision.confidenceChange>0?"+":""}{todayDecision.confidenceChange} confianza</b>}{todayDecision.budgetChange!==0&&<b>{todayDecision.budgetChange>0?"+":""}{todayDecision.budgetChange.toFixed(2).replace(".",",")} M</b>}{todayDecision.reputationChange!==0&&<b>+{todayDecision.reputationChange} reputación</b>}</aside></article>
    :selected?<article className="career-interlude-confirm"><div><small>ANTES DE CONFIRMAR</small><h3>{selected.title}</h3><p>{selected.summary}</p></div><section><p><b>Ocurre ahora</b><span>{selected.immediate}</span></p><p><b>Al regresar en la J{interlude.toMatchday}</b><span>{selected.returnEffect}</span></p></section><footer><button disabled={saving} onClick={()=>setSelected(null)}>Volver</button><button disabled={saving} onClick={()=>void confirm(selected)}>{saving?"Confirmando…":"Elegir este plan"}</button></footer></article>
    :<div className="career-interlude-options">{interlude.choices.map((choice)=><button key={choice.key} disabled={!interlude.canDecide||saving} onClick={()=>setSelected(choice)}><small>{choice.key==="recovery"?"VESTUARIO":choice.key==="tactical"?"PREPARACIÓN":choice.key==="academy"?"IDENTIDAD":"RECURSOS"}</small><strong>{choice.title}</strong><p>{choice.summary}</p><span><b>HOY</b>{choice.immediate}</span><span><b>EFECTO</b>{choice.returnEffect}</span><em>Ver consecuencias →</em></button>)}</div>}
    {actions.length>0&&<footer className="career-interlude-history"><strong>Diario del interludio</strong>{actions.slice().reverse().map((action,index)=><span key={`${action.actionDate??action.decidedAt}-${index}`}><b>{action.actionDate?new Date(`${action.actionDate}T12:00:00`).toLocaleDateString("es-ES",{day:"numeric",month:"short"}):"Día anterior"}</b>{action.title}</span>)}</footer>}
  </section>;
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
      ? workspace.delegation.current?<DelegatedCareerLineup career={career} workspace={workspace}/>:<CareerLineupEditor career={career} workspace={workspace} rules={rules} draft={draft} onDraftChange={onDraftChange} onSave={onSave} notify={notify} />
      : <HistoricalCareerLineup career={career} workspace={workspace} matchday={selectedMatchday} catalog={catalog} onCurrent={() => onSelectMatchday(career.matchday)} />}
  </section>;
}

function DelegatedCareerLineup({career,workspace}:{career:NexoCareer;workspace:NexoCareerWorkspace}){
  const delegation=workspace.delegation.current!;const plan=workspace.delegation.plans.find((item)=>item.key===delegation.plan);const selected=workspace.squad.filter((player)=>delegation.playerIds.includes(player.id));
  return <section className="career-delegated-lineup"><header><div><p className="eyebrow">JORNADA {career.matchday} · ONCE DELEGADO</p><h2>{plan?.title}</h2><p>El segundo entrenador ha cerrado este once. Puedes revisarlo, pero cualquier cambio, fichaje o venta queda bloqueado hasta la próxima jornada.</p></div><span>{delegation.formation}</span></header><div className="football-pitch league-detail-pitch fantasy-draft-pitch"><div className="field-line center-line"/><div className="field-line center-circle"/>{(["DEL","MED","DEF","POR"] as PlayerPosition[]).map((position)=><div className="player-row" key={position}>{selected.filter((player)=>player.position===position).map((player)=><div className="pitch-player lineup-player historical" key={player.id}><Avatar player={player}/><strong>{player.name}</strong><small>{player.id===delegation.captainId?"Capitán":player.id===delegation.viceCaptainId?"Vicecapitán":player.isOriginal?"Original":"Fichaje"}</small></div>)}</div>)}</div><footer><span><b>{workspace.delegation.remaining}</b> delegaciones restantes</span><span>Próximo uso: J{workspace.delegation.nextAvailableMatchday}</span><strong>Coste aplicado: {delegation.cost.toFixed(2).replace(".",",")} M</strong></footer></section>
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

export function CareerLineupEditor({ career, workspace, rules, draft, onDraftChange, onSave, notify }: { career: NexoCareer; workspace: NexoCareerWorkspace; rules: CareerRules; draft: NexoCareerLineup | null; onDraftChange: (lineup: NexoCareerLineup) => void; onSave: (lineup: NexoCareerLineup) => Promise<void>; notify: (value: string) => void }) {
  const saved = workspace.lineups.find((item) => item.matchday === career.matchday);
  const initial = draft ?? saved;
  const [formation,setFormation]=useState(initial?.formation??"4-4-2"); const [ids,setIds]=useState<string[]>(initial?.playerIds.filter((id)=>workspace.squad.some((player)=>player.id===id))??[]); const [captain,setCaptain]=useState(initial?.captainId??""); const [filter,setFilter]=useState<PlayerPosition|"Todos">("Todos"); const [saving,setSaving]=useState(false);
  useEffect(()=>{onDraftChange({matchday:career.matchday,formation,playerIds:ids,captainId:captain,savedAt:"draft"})},[formation,ids,captain]);
  const selected=workspace.squad.filter((player)=>ids.includes(player.id)); const originals=selected.filter((player)=>player.isOriginal).length; const valid=ids.length===11&&ids.includes(captain)&&originals>=rules.minimumOriginalLineup&&(Object.keys(formations[formation]) as PlayerPosition[]).every((position)=>selected.filter((player)=>player.position===position).length===formations[formation][position]);
  function changeFormation(next:string){const kept=(Object.keys(formations[next]) as PlayerPosition[]).flatMap((position)=>selected.filter((player)=>player.position===position).slice(0,formations[next][position]).map((player)=>player.id));setFormation(next);setIds(kept);if(!kept.includes(captain))setCaptain("")}
  function toggle(player:NexoCareerPlayer){if(ids.includes(player.id)){setIds(ids.filter((id)=>id!==player.id));if(captain===player.id)setCaptain("");return}if(selected.filter((item)=>item.position===player.position).length>=formations[formation][player.position]){notify(`Ya están completas las plazas de ${player.position}`);return}setIds([...ids,player.id])}
  async function submit(){if(!valid)return;setSaving(true);try{await onSave({matchday:career.matchday,formation,playerIds:ids,captainId:captain,savedAt:new Date().toISOString()})}catch(error){notify(error instanceof Error?error.message:"No se pudo guardar")}finally{setSaving(false)}}
  return <section className="career-lineup-editor"><div className="league-section-heading"><div><p className="eyebrow">JORNADA {career.matchday} · ONCE DE CARRERA</p><h2>Elige quién representa tu proyecto</h2><p>Solo puedes utilizar jugadores de tu plantilla. El servidor comprobará de nuevo todas las reglas.</p></div><button className="primary-button" disabled={!valid||saving} onClick={submit}>{saving?"Guardando…":saved?"Actualizar once":`${ids.length}/11 · Guardar`}</button></div><div className="career-lineup-status"><span><small>FORMACIÓN</small><strong>{formation}</strong></span><span><small>ORIGINALES</small><strong className={originals>=rules.minimumOriginalLineup?"ok":""}>{originals}/{rules.minimumOriginalLineup} mín.</strong></span><span><small>CAPITÁN</small><strong>{workspace.squad.find((item)=>item.id===captain)?.name??"Pendiente"}</strong></span><span><small>ESTADO</small><strong className={valid?"ok":""}>{valid?"Listo":"Incompleto"}</strong></span></div><div className="formation-picker career-formations"><small>FORMACIÓN</small>{Object.keys(formations).map((item)=><button className={formation===item?"active":""} key={item} onClick={()=>changeFormation(item)}>{item}</button>)}</div>
    <div className="career-lineup-grid"><article className="pitch-card"><div className="pitch-header"><div><p className="eyebrow">TU ONCE · {ids.length}/11</p><h2>{formation}</h2></div><span className="saved-state">Toca para quitar · elige capitán abajo</span></div><div className="football-pitch league-detail-pitch fantasy-draft-pitch"><div className="field-line center-line"/><div className="field-line center-circle"/>{(["DEL","MED","DEF","POR"] as PlayerPosition[]).map((position)=><div className="player-row" key={position}>{selected.filter((player)=>player.position===position).map((player)=><button className="pitch-player lineup-player" key={player.id} onClick={()=>toggle(player)}><Avatar player={player}>{captain===player.id&&<b>C</b>}</Avatar><strong>{player.name}</strong><small>{player.isOriginal?"Original":"Fichaje"}</small></button>)}{Array.from({length:Math.max(0,formations[formation][position]-selected.filter((player)=>player.position===position).length)},(_,index)=><span className="empty-pitch-slot" key={index}>+</span>)}</div>)}</div></article><aside className="career-squad-selector"><header><p className="eyebrow">PLANTILLA DISPONIBLE</p><h3>{workspace.squad.length} jugadores</h3><small>Selecciona once respetando las posiciones.</small></header><nav>{(["Todos","POR","DEF","MED","DEL"] as const).map((item)=><button className={filter===item?"active":""} key={item} onClick={()=>setFilter(item)}>{item}</button>)}</nav><div>{workspace.squad.filter((player)=>filter==="Todos"||player.position===filter).map((player)=>{const active=ids.includes(player.id);return <button className={active?"selected":""} key={player.id} onClick={()=>toggle(player)}><Avatar player={player}/><p><strong>{player.name}</strong><small>{player.position} · {player.club}</small></p><b>{player.isOriginal?"ORIGINAL":"FICHAJE"}</b><em>{active?"Quitar":"Alinear"}</em></button>})}</div></aside></div><div className="career-captain-row"><p><strong>Elige capitán</strong><small>Debe formar parte del once guardado.</small></p><div>{selected.map((player)=><button className={captain===player.id?"active":""} key={player.id} onClick={()=>setCaptain(player.id)}><Avatar player={player}/><span>{player.name}</span></button>)}</div></div></section>;
}

export function CareerMarket({ career,workspace,rules,alignedPlayerIds,busy,onOperation }:{career:NexoCareer;workspace:NexoCareerWorkspace;rules:CareerRules;alignedPlayerIds:string[];busy:boolean;onOperation:(type:"buy"|"sell",player:NexoCareerPlayer)=>void}){
  const [tab,setTab]=useState<"buy"|"sell">("buy");const [query,setQuery]=useState("");const [position,setPosition]=useState<PlayerPosition|"Todos">("Todos");const originals=workspace.squad.filter((item)=>item.isOriginal).length;const source=tab==="buy"?workspace.market:workspace.squad;const visible=useMemo(()=>source.filter((player)=>(position==="Todos"||player.position===position)&&`${player.name} ${player.club}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es"))),[source,position,query]);
  return <section className="career-market"><header><div><p className="eyebrow">MERCADO INDIVIDUAL · JORNADA {career.matchday}</p><h2>Construye tu propia versión del club</h2><p>Las operaciones son inmediatas y solo afectan a esta Carrera.</p></div><article><small>SALDO DISPONIBLE</small><strong>{workspace.budget.toFixed(1).replace(".",",")} M</strong><span>{workspace.squad.length}/25 jugadores</span></article></header><div className="career-market-tabs"><button className={tab==="buy"?"active":""} onClick={()=>setTab("buy")}>Fichar <b>{workspace.market.length}</b></button><button className={tab==="sell"?"active":""} onClick={()=>setTab("sell")}>Mi plantilla <b>{workspace.squad.length}</b></button></div><div className="career-market-tools"><label><span>⌕</span><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Buscar jugador o club"/></label><nav>{(["Todos","POR","DEF","MED","DEL"] as const).map((item)=><button className={position===item?"active":""} key={item} onClick={()=>setPosition(item)}>{item}</button>)}</nav></div><div className="career-market-list">{visible.map((player)=>{const aligned=tab==="sell"&&alignedPlayerIds.includes(player.id);const unavailable=tab==="buy"?(player.value>workspace.budget||workspace.squad.length>=25):(aligned||workspace.squad.length<=11||(player.isOriginal&&originals<=rules.minimumOriginalSquad));return <article className={aligned?"aligned":""} key={player.id}><Avatar player={player}/><p><strong>{player.name}</strong><small>{player.position} · {player.club}{player.isOriginal?" · Original":""}</small>{aligned&&<b className="career-aligned-badge">ALINEADO</b>}</p><span><small>VALOR</small><strong>{player.value.toFixed(1).replace(".",",")} M</strong></span><button disabled={busy||unavailable} onClick={()=>onOperation(tab,player)}>{tab==="buy"?(unavailable?"No disponible":"Fichar"):(aligned?"En el once":unavailable?"Protegido":"Vender")}</button></article>})}</div><article className="career-market-note"><span>✓</span><p><strong>Operaciones protegidas por el servidor</strong><small>Se comprueban saldo, competición, límite de plantilla, identidad y alineación guardada justo antes de confirmar.</small></p></article></section>;
}
