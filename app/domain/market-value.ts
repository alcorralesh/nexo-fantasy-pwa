export interface MarketValueConfig {
  windowHours: number;
  demandWeight: number;
  netTransfersWeight: number;
  bidPremiumWeight: number;
  sensitivity: number;
  maxChangePercent: number;
  minimumDistinctLeagues: number;
  minimumValue: number;
  roundingStep: number;
  frozen: boolean;
}

export interface AggregatedMarketSignals {
  demandZScore: number;
  netTransfersZScore: number;
  medianBidPremiumPercent: number;
  distinctLeagues: number;
}

export const defaultMarketValueConfig: MarketValueConfig = {
  windowHours: 72,
  demandWeight: 0.45,
  netTransfersWeight: 0.35,
  bidPremiumWeight: 0.2,
  sensitivity: 0.08,
  maxChangePercent: 5,
  minimumDistinctLeagues: 5,
  minimumValue: 0.1,
  roundingStep: 0.1,
  frozen: false,
};

export function calculateNextMarketValue(currentValue: number, signals: AggregatedMarketSignals, config: MarketValueConfig) {
  if (config.frozen) return { value: currentValue, changePercent: 0, confidence: 0 };
  const confidence = Math.min(1, signals.distinctLeagues / Math.max(1, config.minimumDistinctLeagues));
  const premiumSignal = Math.max(-1, Math.min(1, signals.medianBidPremiumPercent / 20));
  const pressure = config.demandWeight * signals.demandZScore
    + config.netTransfersWeight * signals.netTransfersZScore
    + config.bidPremiumWeight * premiumSignal;
  const rawChangePercent = Math.tanh(pressure) * config.sensitivity * 100 * confidence;
  const changePercent = Math.max(-config.maxChangePercent, Math.min(config.maxChangePercent, rawChangePercent));
  const unrounded = Math.max(config.minimumValue, currentValue * (1 + changePercent / 100));
  const value = Math.round(unrounded / config.roundingStep) * config.roundingStep;
  return { value: Number(value.toFixed(2)), changePercent: Number(changePercent.toFixed(2)), confidence: Number(confidence.toFixed(2)) };
}

