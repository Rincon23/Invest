import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  DEFAULT_SPECIAL_CATEGORY_LABELS,
  DEFAULT_TOPICS,
  createDefaultTopics,
  type BudgetSettings,
} from '@/lib/budget';
import { ConfirmProvider } from '@/components/ui/ConfirmSheet';
import { ToastProvider } from '@/components/ui/Toast';
import { CategoriesSettings } from '../CategoriesSettings';

const settingsState: { settings: BudgetSettings; saveSettings: ReturnType<typeof vi.fn> } = {
  settings: { topics: [], specialCategories: DEFAULT_SPECIAL_CATEGORY_LABELS },
  saveSettings: vi.fn(),
};

vi.mock('@/components/providers/SettingsProvider', () => ({
  useSettings: () => settingsState,
}));

function renderSettings(settings: Partial<BudgetSettings> = {}) {
  settingsState.settings = {
    topics: createDefaultTopics(),
    specialCategories: DEFAULT_SPECIAL_CATEGORY_LABELS,
    modules: { expenses: true, budget: true },
    ...settings,
  };
  settingsState.saveSettings = vi.fn().mockResolvedValue(undefined);
  render(
    <ToastProvider>
      <ConfirmProvider>
        <CategoriesSettings withTargets />
      </ConfirmProvider>
    </ToastProvider>,
  );
  return settingsState;
}

const savedTopics = (state: typeof settingsState) =>
  (state.saveSettings.mock.calls[0][0] as BudgetSettings).topics;

describe('CategoriesSettings', () => {
  it('mostra as quatro com para que serve cada uma, sem criar, arquivar nem renomear', () => {
    renderSettings();
    for (const preset of DEFAULT_TOPICS) {
      expect(screen.getByText(preset.name)).toBeInTheDocument();
      expect(screen.getByText(preset.description)).toBeInTheDocument();
    }
    expect(screen.getByText('Prazeres e Confortos')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /adicionar categoria/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /arquivar|excluir|mover/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Nome da categoria')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Para que serve esta categoria?')).not.toBeInTheDocument();
  });

  it('salva a % e a cor, só com 100%', async () => {
    const state = renderSettings();
    const save = screen.getByRole('button', { name: 'Salvar categorias' });

    fireEvent.change(screen.getByLabelText('Percentual de Investimentos', { selector: 'input' }), {
      target: { value: '35' },
    });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Percentual de Metas', { selector: 'input' }), {
      target: { value: '35' },
    });
    fireEvent.change(screen.getByLabelText('Cor de Metas'), { target: { value: '#123456' } });
    fireEvent.click(save);

    await waitFor(() => expect(state.saveSettings).toHaveBeenCalledTimes(1));
    const topics = savedTopics(state);
    expect(topics.map((t) => t.name)).toEqual(DEFAULT_TOPICS.map((t) => t.name));
    expect(topics.find((t) => t.preset === 'metas')).toMatchObject({ targetPct: 0.35, color: '#123456' });
  });

  it('volta às % padrão, mantendo as quatro', async () => {
    const defaults = createDefaultTopics();
    const state = renderSettings({
      topics: [
        { ...defaults[0], targetPct: 0.4 },
        { ...defaults[1], targetPct: 0.25 },
        defaults[2],
        defaults[3],
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Voltar às % padrão' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: /voltar às % padrão/i })).getByRole('button', {
        name: 'Voltar',
      }),
    );

    await waitFor(() => expect(state.saveSettings).toHaveBeenCalledTimes(1));
    const topics = savedTopics(state);
    expect(topics.map((t) => t.id)).toEqual(defaults.map((t) => t.id));
    expect(topics.map((t) => t.targetPct)).toEqual(DEFAULT_TOPICS.map((t) => t.targetPct));
  });

  it('diz quando as % já estão no padrão', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar às % padrão' }));
    expect(screen.getByText('Suas categorias já estão com as % padrão.')).toBeInTheDocument();
  });
});
