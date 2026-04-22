/**
 * Грубая оценка расхода ккал (MET × масса × время) по средней скорости.
 * Масса по умолчанию 70 кг — отображайте как «примерно / ≈».
 */
const DEFAULT_WEIGHT_KG = 70;

function metFromSpeedKmh(v) {
  if (!Number.isFinite(v) || v < 0) return 5;
  if (v < 3.5) return 3.3;
  if (v < 5) return 4.3;
  if (v < 6.5) return 6.5;
  if (v < 8) return 8.3;
  if (v < 10) return 9.8;
  if (v < 12) return 11.5;
  if (v < 14) return 13.5;
  return 15;
}

function estimateWorkoutCaloriesKcal(distanceM, durationSec, weightKg = DEFAULT_WEIGHT_KG) {
  const d = Number(distanceM) || 0;
  const t = Number(durationSec) || 0;
  if (d <= 0 || t <= 0) return 0;
  const kmh = (d / 1000) / (t / 3600);
  return metFromSpeedKmh(kmh) * weightKg * (t / 3600);
}

module.exports = {
  DEFAULT_WEIGHT_KG,
  estimateWorkoutCaloriesKcal
};
