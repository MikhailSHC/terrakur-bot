const {
  resolveSimulateEnabled,
  clampRouteStepIndex,
  nextRouteStepIndex
} = require('../public/mini-app/simulateHelpers');

describe('simulate=1 helpers for planned routes', () => {
  it('enables simulate mode from URL query values', () => {
    expect(resolveSimulateEnabled('?routeId=abc&simulate=1')).toBe(true);
    expect(resolveSimulateEnabled('?simulate=true')).toBe(true);
    expect(resolveSimulateEnabled('?simulate=on')).toBe(true);
    expect(resolveSimulateEnabled('?simulate=0')).toBe(false);
    expect(resolveSimulateEnabled('?routeId=abc')).toBe(false);
  });

  it('clamps step index to valid route bounds', () => {
    expect(clampRouteStepIndex(-5, 10)).toBe(0);
    expect(clampRouteStepIndex(0, 10)).toBe(0);
    expect(clampRouteStepIndex(9, 10)).toBe(9);
    expect(clampRouteStepIndex(50, 10)).toBe(9);
    expect(clampRouteStepIndex(3, 0)).toBe(0);
  });

  it('moves simulation step safely by delta', () => {
    expect(nextRouteStepIndex(0, 5, 1)).toBe(1);
    expect(nextRouteStepIndex(3, 5, 1)).toBe(4);
    expect(nextRouteStepIndex(4, 5, 1)).toBe(4);
    expect(nextRouteStepIndex(2, 5, -2)).toBe(0);
    expect(nextRouteStepIndex(2, 5, 10)).toBe(4);
  });
});
