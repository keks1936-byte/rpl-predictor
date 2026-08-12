export type Score = { home: number; away: number };

function outcome(score: Score) {
  if (score.home > score.away) return 'H';
  if (score.home < score.away) return 'A';
  return 'D';
}

export function calculatePoints(prediction: Score, actual: Score): 0 | 1 | 3 {
  if (prediction.home === actual.home && prediction.away === actual.away) return 3;
  if (outcome(prediction) === outcome(actual)) return 1;
  return 0;
}
