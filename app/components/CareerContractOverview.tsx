"use client";

export type CareerContractObjective = {
  type: string;
  metricKey?: string | null;
  targetValue: number;
  currentValue: number;
  expiresMatchday?: number | null;
  description: string;
};

type CareerHeroOverviewProps = {
  matchday: number;
  difficulty: string;
  clubName: string;
  confidence: number;
  budget: number;
  sportingPoints: number;
  originalCount: number;
  squadCount: number;
  tierLabel: string;
  delegated?: boolean;
  onLineup: () => void;
  onMarket: () => void;
  onDelegate?: () => void;
  delegateDisabled?: boolean;
  calendar?: CareerCalendarWindow;
};

export type CareerCalendarWindow = {
  currentStartAt?: string;
  currentEndAt?: string;
  nextMatchday?: number;
  nextStartAt?: string;
};

function calendarDate(value?: string) {
  if (!value) return "Fecha pendiente";
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)).replace(",", " ·");
}

export function CareerHeroOverview({ matchday, difficulty, clubName, confidence, budget, sportingPoints, originalCount, squadCount, tierLabel, delegated = false, onLineup, onMarket, onDelegate, delegateDisabled = false, calendar }: CareerHeroOverviewProps) {
  const difficultyLabel = difficulty === "elite" ? "ÉLITE" : difficulty === "relaxed" ? "CANTERA" : "PROFESIONAL";
  const difficultyDetail = difficulty === "elite" ? "Máxima exigencia" : difficulty === "relaxed" ? "Margen amplio" : "Exigencia equilibrada";
  const initials = clubName.split(/\s+/).map((word) => word[0]).slice(0, 2).join("");
  const gapDays = calendar?.currentEndAt && calendar?.nextStartAt ? Math.max(0, Math.ceil((new Date(calendar.nextStartAt).getTime() - new Date(calendar.currentEndAt).getTime()) / 86400000)) : null;
  return <>
    <article className="career-hero"><div><p className="eyebrow">JORNADA {matchday} · {difficultyLabel}</p><h1>Que el club recuerde tu nombre.</h1><p>Conserva su identidad, mejora la plantilla y responde a una directiva que evaluará cada decisión.</p><div className="career-calendar-strip"><span><small>COMIENZA</small><strong>{calendarDate(calendar?.currentStartAt)}</strong></span><span><small>TERMINA</small><strong>{calendarDate(calendar?.currentEndAt)}</strong></span><span><small>SIGUIENTE · J{calendar?.nextMatchday ?? matchday + 1}</small><strong>{calendarDate(calendar?.nextStartAt)}</strong>{gapDays !== null && <em>{gapDays === 0 ? "Comienza inmediatamente" : `${gapDays} ${gapDays === 1 ? "día" : "días"} después`}</em>}</span></div><div className="career-hero-actions"><button onClick={onLineup}>{delegated ? "Revisar el once" : "Preparar el once"} →</button><button disabled={delegated} onClick={onMarket}>Abrir mercado</button>{onDelegate && !delegated && <button disabled={delegateDisabled} onClick={onDelegate}>Delegar jornada</button>}</div></div><section><span>{initials}</span><p><small>CONFIANZA DIRECTIVA</small><strong>{confidence}<i>/100</i></strong></p><div><i style={{ width: `${confidence}%` }} /></div></section></article>
    <div className="career-kpis"><article><small>PRESUPUESTO</small><strong>{budget.toFixed(1).replace(".", ",")} M</strong><span>Mercado exclusivo</span></article><article><small>PUNTOS DEPORTIVOS</small><strong>{sportingPoints}</strong><span>Temporada actual</span></article><article><small>IDENTIDAD</small><strong>{originalCount}/{squadCount}</strong><span>Jugadores originales</span></article><article><small>CONTRATO</small><strong>{tierLabel}</strong><span>{difficultyDetail}</span></article></div>
  </>;
}

type CareerContractOverviewProps = {
  tierLabel: string;
  matchday: number;
  objectives: CareerContractObjective[];
  originalCount: number;
  confidence: number;
  consecutiveFailures: number;
  dismissalThreshold: number;
  sportingPoints: number;
};

function missionTarget(objective: CareerContractObjective) {
  const target = objective.targetValue.toFixed(0);
  if (objective.metricKey === "originals") return `Alinea al menos ${target} jugadores originales`;
  if (objective.metricKey === "captain_points") return `Consigue ${target} puntos con tu capitán`;
  if (objective.metricKey === "new_signings") return `Alinea al menos ${target} fichajes nuevos`;
  if (objective.metricKey === "budget_floor") return `Conserva al menos ${target} M de presupuesto`;
  return `Consigue ${target} puntos con tu once`;
}

export function CareerContractOverview({
  tierLabel,
  matchday,
  objectives,
  originalCount,
  confidence,
  consecutiveFailures,
  dismissalThreshold,
  sportingPoints,
}: CareerContractOverviewProps) {
  const seasonObjective = objectives.find((item) => item.type === "season");
  const matchdayObjective = objectives.find((item) => item.type === "matchday" && item.expiresMatchday === matchday);
  const identityObjective = objectives.find((item) => item.type === "identity");
  const confidenceObjective = objectives.find((item) => item.type === "confidence");
  const seasonValue = seasonObjective ? sportingPoints : 0;
  const progress = seasonObjective
    ? Math.min(100, Math.round((seasonValue / Math.max(1, seasonObjective.targetValue)) * 100))
    : 0;
  const confidenceMargin = Math.max(0, confidence - dismissalThreshold);
  const jobRisk = consecutiveFailures >= 2 || confidence <= dismissalThreshold + 5
    ? "danger"
    : consecutiveFailures >= 1 || confidence <= dismissalThreshold + 20
      ? "warning"
      : "safe";
  const jobRiskLabel = jobRisk === "danger" ? "Puesto en peligro" : jobRisk === "warning" ? "En observación" : "Puesto seguro";

  return <article className="career-objectives">
    <p className="eyebrow">TU CONTRATO · {tierLabel.toUpperCase()}</p>
    <h2>Tu misión, en sencillo</h2>
    <p className="career-contract-intro">Cada jornada preparas el once. Cuando termina, el juego suma sus puntos y comprueba estos objetivos.</p>
    <div className="career-contract-summary">
      {matchdayObjective && <section><span>1</span><p><small>MISIÓN DE ESTA JORNADA</small><strong>{missionTarget(matchdayObjective)}</strong><em>{matchdayObjective.description} · se comprueba al cerrar la J{matchday}</em></p></section>}
      {seasonObjective && <section><span>2</span><p><small>TODA LA TEMPORADA</small><strong>Acumula {seasonObjective.targetValue.toFixed(0)} puntos</strong><em>Llevas {seasonValue.toFixed(0)} · progreso {progress}%</em></p></section>}
      {identityObjective && <section><span>3</span><p><small>IDENTIDAD DEL CLUB</small><strong>Conserva al menos {identityObjective.targetValue.toFixed(0)} jugadores originales</strong><em>Ahora tienes {originalCount} en la plantilla</em></p></section>}
      {confidenceObjective && <section><span>4</span><p><small>CONFIANZA DE LA DIRECTIVA</small><strong>Termina la temporada con {confidenceObjective.targetValue.toFixed(0)} o más</strong><em>Ahora tienes {confidence}/100</em></p></section>}
    </div>
    <div className="career-contract-flow"><p><b>①</b><span><strong>Guarda tu once</strong><small>Elige 11 jugadores y un capitán.</small></span></p><p><b>②</b><span><strong>Se juega la jornada</strong><small>Tus futbolistas consiguen puntos reales.</small></span></p><p><b>③</b><span><strong>Se evalúa</strong><small>Ganas recompensas o baja la confianza.</small></span></p></div>
    <section className={`career-job-safety ${jobRisk}`}>
      <header><div><small>SEGURIDAD DEL PUESTO</small><strong>{jobRiskLabel}</strong></div><b>{confidence}/100 confianza</b></header>
      <div className="career-confidence-meter"><i style={{ left: `${dismissalThreshold}%` }}><span>Despido ≤ {dismissalThreshold}</span></i><b style={{ width: `${confidence}%` }} /></div>
      <div className="career-failure-counter"><p><strong>Fallos consecutivos</strong><small>El contador vuelve a cero cuando completas la misión de una jornada.</small></p><span>{[0, 1, 2].map((index) => <i className={index < consecutiveFailures ? "filled" : ""} key={index}>{index < consecutiveFailures ? "×" : index + 1}</i>)}</span><b>{consecutiveFailures}/3</b></div>
      <footer>{consecutiveFailures === 0 ? `Tienes ${confidenceMargin} puntos de margen sobre el umbral y ningún fallo acumulado.` : "Necesitas completar la próxima misión para cortar la racha de fallos."}</footer>
    </section>
  </article>;
}
