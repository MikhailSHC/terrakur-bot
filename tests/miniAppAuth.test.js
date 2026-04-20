const { createMiniAppToken, verifyMiniAppToken, TOKEN_TTL_MS } = require('../utils/miniAppAuth');

describe('miniAppAuth', () => {
  it('creates and verifies token', () => {
    const secret = 'test-secret';
    const token = createMiniAppToken('12345', secret, 1_700_000_000_000);
    const result = verifyMiniAppToken('12345', token, secret, 1_700_000_100_000);
    expect(result.ok).toBe(true);
  });

  it('rejects token for another chatId', () => {
    const secret = 'test-secret';
    const token = createMiniAppToken('12345', secret, 1_700_000_000_000);
    const result = verifyMiniAppToken('99999', token, secret, 1_700_000_100_000);
    expect(result.ok).toBe(false);
  });

  it('rejects expired token', () => {
    const secret = 'test-secret';
    const issuedAt = 1_700_000_000_000;
    const token = createMiniAppToken('12345', secret, issuedAt);
    const result = verifyMiniAppToken('12345', token, secret, issuedAt + TOKEN_TTL_MS + 1);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('expired');
  });
});
