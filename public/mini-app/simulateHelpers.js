(function initTerraSimHelpers(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TerraSimHelpers = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function buildSimHelpers() {
  function resolveSimulateEnabled(search) {
    const params = new URLSearchParams(search || '');
    const raw = String(params.get('simulate') || '').toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'on';
  }

  function clampRouteStepIndex(idx, coordsLength) {
    if (!Number.isFinite(coordsLength) || coordsLength <= 0) return 0;
    const max = coordsLength - 1;
    const normalized = Number.isFinite(idx) ? Math.round(idx) : 0;
    return Math.min(Math.max(0, normalized), max);
  }

  function nextRouteStepIndex(currentIndex, coordsLength, delta = 1) {
    const base = clampRouteStepIndex(currentIndex, coordsLength);
    const step = Number.isFinite(delta) ? delta : 1;
    return clampRouteStepIndex(base + step, coordsLength);
  }

  return {
    resolveSimulateEnabled,
    clampRouteStepIndex,
    nextRouteStepIndex
  };
});
