import { describe, expect, it } from 'vitest';
import { isAllowedPushEndpoint } from '../endpoints';

describe('isAllowedPushEndpoint', () => {
  it('accepts the push services of the real browsers', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc:def')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/QGx7abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://wns2-bl2p.notify.windows.com/w/?token=abc')).toBe(true);
  });

  it('refuses any other site, which would make the server a relay', () => {
    expect(isAllowedPushEndpoint('https://example.com/fcm.googleapis.com')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://evilnotify.windows.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://192.168.0.1/')).toBe(false);
    expect(isAllowedPushEndpoint('https://localhost/')).toBe(false);
  });

  it('refuses plain http, other ports, credentials and garbage', () => {
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/fcm/send/abc')).toBe(false);
    expect(isAllowedPushEndpoint('https://user:pass@fcm.googleapis.com/fcm/send/abc')).toBe(false);
    expect(isAllowedPushEndpoint('não é url')).toBe(false);
  });
});
