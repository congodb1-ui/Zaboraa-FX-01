export interface OverfittingScoreBreakdown {
  totalScore: number;
  label: 'Lower Estimated Overfitting Risk' | 'Moderate Empirical Divergence' | 'Elevated Overfitting Indication';
  terms: {
    oosDegradation: number;
    parameterSensitivity: number;
    tradesPerParameterPenalty: number;
    trialCountPenalty: number;
    sampleSizePenalty: number;
  };
  weights: {
    w1_oos: number;
    w2_sens: number;
    w3_tpp: number;
    w4_trials: number;
    w5_sample: number;
  };
  explanations: string[];
}

export interface OverfittingInput {
  isSharpe: number;
  oosSharpe: number;
  isTrades: number;
  oosTrades: number;
  paramCount: number;
  totalTrialsTested?: number;
  neighborSharpes?: number[];
  normalizedNeighborDistances?: number[]; // for random search fallback
}

/**
 * Calculates the Heuristic Overfitting Score (0 - 100)
 * Note: Weights and thresholds are empirical heuristics and do not constitute an absolute safety guarantee.
 */
export function calculateHeuristicOverfittingScore(input: OverfittingInput): OverfittingScoreBreakdown {
  const isSharpe = Math.max(-2, input.isSharpe);
  const oosSharpe = Math.max(-2, input.oosSharpe);
  const isTrades = Math.max(0, input.isTrades);
  const paramCount = Math.max(1, input.paramCount);
  const trials = Math.max(1, input.totalTrialsTested || 1);

  const explanations: string[] = [];

  // Term 1: Out-of-Sample Degradation (Capped at 100)
  let tOos = 0;
  if (isSharpe > 0.05) {
    const rawDegradation = (isSharpe - oosSharpe) / isSharpe;
    tOos = Math.min(100, Math.max(0, rawDegradation * 100));
    if (tOos > 40) {
      explanations.push(`Out-of-sample performance decayed by ${tOos.toFixed(1)}% compared to in-sample curve.`);
    }
  } else if (oosSharpe < 0 && isSharpe <= 0.05) {
    tOos = 60;
    explanations.push(`Strategy generated negative or flat Sharpe across both in-sample and out-of-sample periods.`);
  }

  // Term 2: Parameter Sensitivity (Capped at 100)
  let tSens = 0;
  if (input.neighborSharpes && input.neighborSharpes.length > 0) {
    const values = input.neighborSharpes;
    const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
    const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    if (input.normalizedNeighborDistances && input.normalizedNeighborDistances.length === values.length) {
      // Random-search fallback: distance-weighted variance
      let weightedVar = 0;
      let totalW = 0;
      for (let k = 0; k < values.length; k++) {
        const dist = Math.max(0.01, input.normalizedNeighborDistances[k]);
        const w = 1 / dist;
        weightedVar += w * Math.pow(values[k] - isSharpe, 2);
        totalW += w;
      }
      const weightedStd = Math.sqrt(weightedVar / Math.max(0.001, totalW));
      tSens = Math.min(100, (weightedStd / Math.max(0.1, Math.abs(isSharpe))) * 100);
    } else {
      // Grid search neighbor coefficient of variation
      tSens = Math.min(100, (stdDev / Math.max(0.1, Math.abs(mean))) * 100);
    }

    if (tSens > 40) {
      explanations.push(`Parameter sensitivity is elevated (${tSens.toFixed(1)}/100). Adjacent settings show abrupt drops in performance.`);
    }
  } else {
    // Default baseline if no neighbors provided
    tSens = 20;
  }

  // Term 3: Trades-per-Parameter Penalty (Capped at 100)
  // Target: at least 30 closed trades per parameter
  const tradesPerParam = isTrades / paramCount;
  const tTpp = Math.min(100, Math.max(0, 100 * (1 - tradesPerParam / 30)));
  if (tTpp > 30) {
    explanations.push(`Trades-per-parameter ratio is ${tradesPerParam.toFixed(1)} (recommended: >= 30 trades per tuned parameter).`);
  }

  // Term 4: Trial-Count / Multiple-Testing Penalty (Capped at 100)
  // log10(N) / log10(1000) * 100
  const tTrials = Math.min(100, Math.max(0, (Math.log10(trials) / Math.log10(1000)) * 100));
  if (trials > 50) {
    explanations.push(`Extensive search over ${trials} trials increases the likelihood of data snooping bias.`);
  }

  // Term 5: Sample Size Penalty (Capped at 100)
  // Target: at least 150 closed in-sample trades for statistical validity
  const tSample = Math.min(100, Math.max(0, 100 * (1 - isTrades / 150)));
  if (tSample > 40) {
    explanations.push(`Sample size (${isTrades} trades) is under the 150-trade threshold for statistical confidence.`);
  }

  // Heuristic weights: w1=0.35, w2=0.25, w3=0.20, w4=0.10, w5=0.10
  const weights = {
    w1_oos: 0.35,
    w2_sens: 0.25,
    w3_tpp: 0.20,
    w4_trials: 0.10,
    w5_sample: 0.10,
  };

  const rawScore =
    weights.w1_oos * tOos +
    weights.w2_sens * tSens +
    weights.w3_tpp * tTpp +
    weights.w4_trials * tTrials +
    weights.w5_sample * tSample;

  const totalScore = Math.min(100, Math.max(0, Math.round(rawScore)));

  let label: 'Lower Estimated Overfitting Risk' | 'Moderate Empirical Divergence' | 'Elevated Overfitting Indication';
  if (totalScore < 25) {
    label = 'Lower Estimated Overfitting Risk';
    if (explanations.length === 0) {
      explanations.push('Stable parameter neighborhood with consistent out-of-sample behavior and adequate trade sample size.');
    }
  } else if (totalScore <= 50) {
    label = 'Moderate Empirical Divergence';
    explanations.push('Noticeable divergence between in-sample and out-of-sample metrics. Walk-forward paper testing recommended.');
  } else {
    label = 'Elevated Overfitting Indication';
    explanations.push('High vulnerability to curve fitting. Parameter fragility or severe out-of-sample performance drop detected.');
  }

  return {
    totalScore,
    label,
    terms: {
      oosDegradation: Math.round(tOos),
      parameterSensitivity: Math.round(tSens),
      tradesPerParameterPenalty: Math.round(tTpp),
      trialCountPenalty: Math.round(tTrials),
      sampleSizePenalty: Math.round(tSample),
    },
    weights,
    explanations,
  };
}
