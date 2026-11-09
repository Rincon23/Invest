import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { levelOf } from '@/lib/gamification/levels';
import type { MissionState, MissionsStatus } from '@/lib/gamification/missions';
import { MissionsBar } from '../MissionsBar';

const claimDay = vi.fn();
let status: MissionsStatus;

vi.mock('../MissionsProvider', () => ({
  useMissions: () => ({ status, level: levelOf(status.xp), landing: false, visit: vi.fn(), claimDay }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mission = (key: string, title: string, period: MissionState['period'], done = false): MissionState => ({
  key: key as MissionState['key'],
  title,
  xp: key === 'open-app' ? 10 : 50,
  period,
  done,
});

const FACT = {
  id: 'fato-1',
  text: 'Sabia que juros compostos ajudam?',
  detail: 'É uma simulação.',
  sourceLabel: 'Banco Central',
  sourceUrl: 'https://www.bcb.gov.br',
};

const withMissions = (missions: MissionState[]): MissionsStatus => ({
  xp: 0,
  missions,
  months: [],
  earned: [],
  fact: FACT,
});

describe('MissionsBar (faixa das Missões na Início)', () => {
  beforeEach(() => claimDay.mockClear());

  it('o XP do dia só vem do "Resgatar", que some depois de tocado', () => {
    status = withMissions([
      mission('first-income', 'Registrar a primeira renda', 'once'),
      mission('open-app', 'Resgatar o XP do dia', 'day'),
    ]);
    render(<MissionsBar />);
    expect(claimDay).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Resgatar 10 XP do dia' }));
    expect(claimDay).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Resgatar/ })).toBeNull();
    expect(screen.getByText('Registrar a primeira renda')).toBeTruthy();
  });

  it('sem "Resgatar" quando o XP de hoje já foi resgatado', () => {
    status = withMissions([
      mission('first-income', 'Registrar a primeira renda', 'once'),
      mission('open-app', 'Resgatar o XP do dia', 'day', true),
    ]);
    render(<MissionsBar />);
    expect(screen.queryByRole('button', { name: /Resgatar/ })).toBeNull();
  });

  it('com tudo feito, fica só para resgatar o dia; depois, some', () => {
    status = withMissions([
      mission('first-income', 'Registrar a primeira renda', 'once', true),
      mission('open-app', 'Resgatar o XP do dia', 'day'),
    ]);
    const { container, rerender } = render(<MissionsBar />);
    expect(screen.getByText('Resgatar o XP do dia')).toBeTruthy();

    status = withMissions([
      mission('first-income', 'Registrar a primeira renda', 'once', true),
      mission('open-app', 'Resgatar o XP do dia', 'day', true),
    ]);
    rerender(<MissionsBar />);
    expect(container.innerHTML).toBe('');
  });

  it('a frase do dia fica na barra e some junto com ela', () => {
    status = withMissions([
      mission('first-income', 'Registrar a primeira renda', 'once', true),
      mission('open-app', 'Resgatar o XP do dia', 'day'),
    ]);
    const { rerender } = render(<MissionsBar />);
    expect(screen.getByText(FACT.text)).toBeTruthy();

    status = withMissions([
      mission('first-income', 'Registrar a primeira renda', 'once', true),
      mission('open-app', 'Resgatar o XP do dia', 'day', true),
    ]);
    rerender(<MissionsBar />);
    expect(screen.queryByText(FACT.text)).toBeNull();
  });

  it('com outra missão aberta, a frase continua depois de resgatar', () => {
    status = withMissions([
      mission('first-income', 'Registrar a primeira renda', 'once'),
      mission('open-app', 'Resgatar o XP do dia', 'day', true),
    ]);
    render(<MissionsBar />);
    expect(screen.getByText(FACT.text)).toBeTruthy();
  });

  it('o toque na frase mostra a explicação e a fonte', async () => {
    status = withMissions([mission('open-app', 'Resgatar o XP do dia', 'day')]);
    render(<MissionsBar />);

    fireEvent.click(screen.getByRole('button', { name: FACT.text }));

    expect(await screen.findByText(FACT.detail)).toBeTruthy();
    expect(screen.getByRole('link', { name: FACT.sourceLabel }).getAttribute('href')).toBe(FACT.sourceUrl);
  });
});
