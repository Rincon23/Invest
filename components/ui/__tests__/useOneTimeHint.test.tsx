import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { DEFAULT_SPECIAL_CATEGORY_LABELS, type BudgetSettings } from '@/lib/budget';
import { useOneTimeHint } from '../useOneTimeHint';

const settingsState: { settings: BudgetSettings; saveSettings: ReturnType<typeof vi.fn> } = {
  settings: { topics: [], specialCategories: DEFAULT_SPECIAL_CATEGORY_LABELS },
  saveSettings: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/components/providers/SettingsProvider', () => ({ useSettings: () => settingsState }));

function Hint({ id }: { id: string }) {
  const { visible } = useOneTimeHint(id, { duration: 1000 });
  return visible ? <p>dica</p> : null;
}

afterEach(() => vi.useRealTimers());

describe('useOneTimeHint', () => {
  it('aparece uma vez, salva o aviso na hora e some sozinha', () => {
    vi.useFakeTimers();
    render(<Hint id="hint:teste" />);
    expect(screen.getByText('dica')).toBeInTheDocument();
    expect(settingsState.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ dismissedNotices: ['hint:teste'] }),
    );
    act(() => vi.advanceTimersByTime(1100));
    expect(screen.queryByText('dica')).not.toBeInTheDocument();
  });

  it('não aparece para quem já viu', () => {
    settingsState.settings = { ...settingsState.settings, dismissedNotices: ['hint:vista'] };
    render(<Hint id="hint:vista" />);
    expect(screen.queryByText('dica')).not.toBeInTheDocument();
  });
});
