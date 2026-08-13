"use client";

import { useState } from "react";
import type { NexoCareerInterludeReport } from "../services/nexo-career";

const signed=(value:number,suffix:string)=>`${value>0?"+":""}${value.toFixed(suffix===" M"?2:0).replace(".",",")}${suffix}`;

export function CareerInterludeReportCard({report,compact=false}:{report:NexoCareerInterludeReport;compact?:boolean}){
  const [open,setOpen]=useState(false);
  const reward=report.reward;
  return <>
    <section className={`career-interlude-report${compact?" compact":""}`}>
      <div className="career-interlude-report-mark">{report.fromMatchday}<span>→</span>{report.toMatchday}</div>
      <div><p className="eyebrow">INTERLUDIO COMPLETADO · ENTRE J{report.fromMatchday} Y J{report.toMatchday}</p><h2>{reward?.title??report.title}</h2><p>{reward?.description??`${report.storyChoices.length} decisiones forman ya parte de la historia del club.`}</p><span className="career-interlude-report-meta"><b>{report.planTitle??"Plan del club"}</b><i>{report.storyChoices.length}/4 capítulos</i></span></div>
      <div className="career-interlude-report-balance"><span><small>CONFIANZA</small><strong>{signed(reward?.confidenceChange??0,"")}</strong></span><span><small>REPUTACIÓN</small><strong>{signed(reward?.reputationChange??0,"")}</strong></span><span><small>PRESUPUESTO</small><strong>{signed(reward?.budgetChange??0," M")}</strong></span><button onClick={()=>setOpen(true)}>Ver informe →</button></div>
    </section>
    {open&&<div className="career-interlude-report-backdrop" onClick={()=>setOpen(false)}><section role="dialog" aria-modal="true" onClick={(event)=>event.stopPropagation()}><header><div><p className="eyebrow">INFORME DEL INTERLUDIO · J{report.fromMatchday} → J{report.toMatchday}</p><h1>{reward?.title??report.title}</h1><p>{reward?.description}</p></div><button aria-label="Cerrar" onClick={()=>setOpen(false)}>×</button></header><div className="career-interlude-report-plan"><span>PLAN ELEGIDO</span><strong>{report.planTitle??"Plan del club"}</strong><small>{report.storyChoices.length} decisiones completadas</small></div><div className="career-interlude-report-story">{report.storyChoices.map((choice,index)=><article key={`${choice.chapter??index}-${choice.key}`}><b>0{index+1}</b><div><small>{choice.label??`CAPÍTULO ${index+1}`}</small><h3>{choice.chapterTitle??choice.title}</h3><strong>{choice.title}</strong><p>{choice.consequence}</p></div><span><i>{signed(choice.confidenceChange," CONF")}</i><i>{signed(choice.reputationChange," REP")}</i><i>{signed(choice.budgetChange," M")}</i></span></article>)}</div><footer><div><span><small>CONFIANZA</small><strong>{signed(reward?.confidenceChange??0,"")}</strong></span><span><small>REPUTACIÓN</small><strong>{signed(reward?.reputationChange??0,"")}</strong></span><span><small>PRESUPUESTO</small><strong>{signed(reward?.budgetChange??0," M")}</strong></span></div><button onClick={()=>setOpen(false)}>Cerrar informe</button></footer></section></div>}
  </>;
}
