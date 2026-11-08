import { loginThrottleKey } from '../../../src/presentation/http/login-throttle-key';

describe('loginThrottleKey', () => {
  it('gives the same key to every spelling of the same address', () => {
    const base = loginThrottleKey('1.2.3.4', 'café@münchen.de');
    expect(loginThrottleKey('1.2.3.4', 'café@xn--mnchen-3ya.de')).toBe(base);
    expect(loginThrottleKey('1.2.3.4', 'CAFÉ@MÜNCHEN.de ')).toBe(base);
    expect(loginThrottleKey('1.2.3.4', 'ａ@x.com')).toBe(loginThrottleKey('1.2.3.4', 'a@x.com'));
  });

  it('still returns a key for a non string or an unparsable value', () => {
    expect(loginThrottleKey('1.2.3.4', 42)).toContain('1.2.3.4|');
    expect(loginThrottleKey('1.2.3.4', 'a@@@')).toContain('1.2.3.4|');
  });
});
