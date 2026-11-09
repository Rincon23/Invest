// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { testAccountEmail } from '../testAccount';

describe('conta de teste do primeiro acesso', () => {
  it('só vale com um e-mail .test, e nunca para o dono', () => {
    expect(testAccountEmail({ TEST_ACCOUNT_EMAIL: ' Teste@Capital.TEST ' })).toBe('teste@capital.test');
    expect(testAccountEmail({})).toBeNull();
    // A real address is never wiped, whatever the config says.
    expect(testAccountEmail({ TEST_ACCOUNT_EMAIL: 'alguem@gmail.com' })).toBeNull();
    expect(testAccountEmail({ TEST_ACCOUNT_EMAIL: 'alguem@teste.com' })).toBeNull();
    expect(
      testAccountEmail({ TEST_ACCOUNT_EMAIL: 'dono@capital.test', OWNER_EMAIL: 'DONO@capital.test' }),
    ).toBeNull();
  });
});
