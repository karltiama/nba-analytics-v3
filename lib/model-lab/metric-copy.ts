/** Plain-language metric copy for the Model Lab. */

export const METRIC_COPY = {
  mae: {
    name: 'MAE',
    plain: 'Average prediction miss. Lower is better.',
  },
  rmse: {
    name: 'RMSE',
    plain: 'Typical size of misses, with large misses counting more. Lower is better.',
  },
  bias: {
    name: 'Signed bias',
    plain: 'Average signed error (prediction minus actual). Near zero is better. Negative means under-predicting.',
  },
  coverage: {
    name: 'Coverage',
    plain: 'Share of eligible rows that produced a finite prediction. Higher is better; 1 means every row scored.',
  },
  n: {
    name: 'N',
    plain: 'Number of eligible player-games in this split.',
  },
  pairedDelta: {
    name: 'Paired ΔMAE',
    plain: 'Difference in MAE on the same player-games. Negative means the right-hand model missed less. Interval is shown only when it was computed from those paired observations.',
  },
} as const;

export const SPLIT_KIND_COPY: Record<string, string> = {
  training: 'Training period. Used to fit, not to claim generalization.',
  selection: 'Validation / selection. Used for early stopping and choosing configs. Not an untouched holdout.',
  historical_confirmation:
    'Previously inspected historical confirmation. Not an untouched holdout. Cannot authorize production promotion.',
  prospective_shadow: 'Prospective shadow. Future holdout after freeze. Empty until live collection starts.',
};

export const HISTORICAL_VALIDITY_NOTE =
  'Historical features here are reconstructed from completed box scores. They are not verified original pregame observations. Publication timestamps and retrospective corrections are not fully observable.';
