import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  DEFAULT_SPECIAL_CATEGORY_LABELS,
  DEFAULT_TOPICS,
  FIXED_COST_TIP,
  createDefaultTopics,
  type BudgetSettings,
} from '@/lib/budget';
import { budgetRepository } from '@/lib/storage';
import { ConfirmProvider } from '@/components/ui/ConfirmSheet';
import { OnboardingWizard } from '../OnboardingWizard';

vi.mock('@/lib/storage', () => ({
  budgetRepository: {
    peekMonth: vi.fn().mockResolvedValue({ incomes: [], expenses: [] }),
    saveIncome: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/storage/preferences', () => ({
  getUnforeseenEstimate: () => 0,
  setUnforeseenEstimate: vi.fn(),
}));

function renderWizard() {
  const settings: BudgetSettings = {
    topics: createDefaultTopics(),
    specialCategories: DEFAULT_SPECIAL_CATEGORY_LABELS,
  };
  const saveSettings = vi.fn().mockResolvedValue(undefined);
  const onComplete = vi.fn();
  render(
    <ConfirmProvider>
      <OnboardingWizard settings={settings} saveSettings={saveSettings} onSkip={vi.fn()} onComplete={onComplete} />
    </ConfirmProvider>,
  );
  return { saveSettings, onComplete };
}

function next() {
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
}

describe('OnboardingWizard (configuração das categorias)', () => {
  it('em 3 passos: renda, custos fixos e imprevistos juntos, e as % com a prévia em R$', async () => {
    const { onComplete } = renderWizard();

    // 1. Income: no intro screen before it.
    expect(screen.getByRole('heading', { name: 'Quanto você ganha por mês?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Renda por mês'), { target: { value: '5000,00' } });
    next();

    // 2. Fixed and unforeseen costs on the same screen; the fixed-cost rule waits behind the ⓘ.
    fireEvent.change(screen.getByLabelText('Custos fixos por mês'), { target: { value: '1000,00' } });
    fireEvent.change(screen.getByLabelText('Imprevistos por mês'), { target: { value: '200,00' } });
    expect(screen.getByText(FIXED_COST_TIP)).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Quando um gasto é custo fixo?' }));
    expect(screen.getByText(FIXED_COST_TIP)).toBeVisible();
    next();

    // 3. Each category says what it is for, with what its % leaves to spend.
    expect(screen.getByRole('heading', { name: 'Quanto vai para cada categoria?' })).toBeInTheDocument();
    for (const preset of DEFAULT_TOPICS) expect(screen.getByText(preset.description)).toBeInTheDocument();
    expect(screen.getByText('R$ 3.800,00')).toBeInTheDocument();
    // Prazeres e Confortos: 20% of R$ 5.000 minus 20% of R$ 1.200.
    expect(screen.getByText('R$ 760,00')).toBeInTheDocument();
    expect(screen.getByText('Somam 100% ✓')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Concluir configuração' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(budgetRepository.saveIncome).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ amount: 5000, source: 'Renda mensal' }),
    );
  });

  it('só muda as % das quatro: não tem como criar categoria', async () => {
    const { saveSettings, onComplete } = renderWizard();

    fireEvent.change(screen.getByLabelText('Renda por mês'), { target: { value: '5000,00' } });
    next();
    next();

    expect(screen.queryByRole('button', { name: /adicionar categoria/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Percentual de Prazeres e Confortos', { selector: 'input' }), {
      target: { value: '10' },
    });
    expect(screen.getByRole('button', { name: 'Concluir configuração' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Percentual de Metas', { selector: 'input' }), {
      target: { value: '35' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Concluir configuração' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    const topics = (saveSettings.mock.calls[0][0] as BudgetSettings).topics;
    expect(topics.map((t) => t.name)).toEqual(DEFAULT_TOPICS.map((t) => t.name));
    expect(topics.map((t) => t.targetPct)).toEqual([0.1, 0.45, 0.35, 0.1]);
  });
});
