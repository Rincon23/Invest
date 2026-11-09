import { describe, expect, it } from 'vitest';
import { firstName, hasRealName, joinName, realName, splitName } from '../names';

describe('nome da pessoa', () => {
  it('o começo do e-mail, que as contas antigas ganharam, não conta como nome', () => {
    expect(hasRealName('enzo.rincon', 'enzo.rincon@gmail.com')).toBe(false);
    expect(hasRealName('', 'x@y.com')).toBe(false);
    expect(hasRealName('Enzo Rincon', 'enzo.rincon@gmail.com')).toBe(true);
    expect(realName('  Enzo   Rincon ', 'a@b.com')).toBe('Enzo Rincon');
  });

  it('chama só pelo primeiro nome', () => {
    expect(firstName('Enzo Rincon')).toBe('Enzo');
    expect(firstName(null)).toBeNull();
  });

  it('separa e junta nome e sobrenome', () => {
    expect(splitName('Ana Maria de Souza')).toEqual({ first: 'Ana', last: 'Maria de Souza' });
    expect(joinName(' Ana ', ' de  Souza ')).toBe('Ana de Souza');
    expect(joinName('', 'Souza')).toBeNull();
  });
});
