import { afterEach, describe, expect, it, vi } from 'vitest';
import { pushSupport } from '../browser';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36';

function device({
  ua,
  touch = 0,
  installed = false,
  push = false,
}: {
  ua: string;
  touch?: number;
  installed?: boolean;
  push?: boolean;
}) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touch, configurable: true });
  vi.stubGlobal('matchMedia', () => ({ matches: installed }));
  if (push) {
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('Notification', class {});
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(navigator, 'maxTouchPoints');
});

describe('pushSupport', () => {
  it('pede para instalar no iPhone no navegador', () => {
    device({ ua: IPHONE });
    expect(pushSupport()).toBe('ios-install');
  });

  it('pede para instalar no iPad, que se diz um Mac', () => {
    device({ ua: IPAD, touch: 5 });
    expect(pushSupport()).toBe('ios-install');
  });

  it('pede para instalar mesmo se o navegador do iPhone expuser o push', () => {
    device({ ua: IPHONE, push: true });
    expect(pushSupport()).toBe('ios-install');
  });

  it('funciona no app instalado no iPhone', () => {
    device({ ua: IPHONE, installed: true, push: true });
    expect(pushSupport()).toBe('supported');
  });

  it('pede para atualizar um iPhone antigo, com o app instalado e sem push', () => {
    device({ ua: IPHONE, installed: true });
    expect(pushSupport()).toBe('ios-update');
  });

  it('funciona no Chrome do Android', () => {
    device({ ua: ANDROID, push: true });
    expect(pushSupport()).toBe('supported');
  });

  it('não confunde um Mac de verdade com iPad', () => {
    device({ ua: IPAD });
    expect(pushSupport()).toBe('unsupported');
  });
});
