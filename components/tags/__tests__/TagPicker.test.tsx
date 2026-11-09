import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  DEFAULT_SPECIAL_CATEGORY_LABELS,
  TAG_NOTICE,
  TAG_VS_CATEGORY,
  createDefaultTopics,
  type BudgetSettings,
  type Expense,
  type Tag,
} from '@/lib/budget';
import { ExpenseFormSheet } from '@/components/month/ExpenseFormSheet';
import { TagPicker } from '../TagPicker';

const topics = createDefaultTopics();
const mercado: Tag = { id: 'mercado', name: 'Mercado', kind: 'expense', order: 0 };
const viagem: Tag = { id: 'viagem', name: 'Viagem', kind: 'expense', order: 1 };
const bico: Tag = { id: 'bico', name: 'Bico', kind: 'income', order: 0 };

const state: {
  settings: BudgetSettings;
  setTags: ReturnType<typeof vi.fn>;
  saveSettings: ReturnType<typeof vi.fn>;
} = {
  settings: { topics, specialCategories: DEFAULT_SPECIAL_CATEGORY_LABELS },
  setTags: vi.fn(),
  saveSettings: vi.fn(),
};

vi.mock('@/components/providers/SettingsProvider', () => ({
  useOptionalSettings: () => state,
  useSettings: () => state,
}));

const saveTag = vi.fn();
vi.mock('@/lib/storage', () => ({
  saveTag: (tag: Tag) => saveTag(tag),
  deleteTag: vi.fn(),
  restoreTag: vi.fn(),
  tagUsage: vi.fn().mockResolvedValue({}),
}));

function withTags(tags: Tag[], dismissed: string[] = [TAG_NOTICE]) {
  state.settings = {
    topics,
    specialCategories: DEFAULT_SPECIAL_CATEGORY_LABELS,
    tags,
    dismissedNotices: dismissed,
  };
}

beforeEach(() => {
  state.setTags = vi.fn();
  state.saveSettings = vi.fn().mockResolvedValue(undefined);
  saveTag.mockReset();
  saveTag.mockImplementation(async (tag: Tag) => [...(state.settings.tags ?? []), tag]);
});

describe('TagPicker', () => {
  it('sem tags, sugere com um toque: cria e já marca', async () => {
    withTags([]);
    const onChange = vi.fn();
    render(<TagPicker kind="expense" value={[]} onChange={onChange} />);

    expect(screen.queryByRole('button', { name: '+ Bico' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ Mercado' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(saveTag).toHaveBeenCalledWith(expect.objectContaining({ name: 'Mercado', kind: 'expense' }));
    const created = saveTag.mock.calls[0][0] as Tag;
    expect(onChange).toHaveBeenCalledWith([created.id]);
    expect(state.setTags).toHaveBeenCalledWith([created]);
  });

  it('marca e desmarca, só com as tags do tipo dele', () => {
    withTags([mercado, viagem, bico]);
    const onChange = vi.fn();
    render(<TagPicker kind="expense" value={['viagem']} onChange={onChange} />);

    expect(screen.queryByRole('button', { name: 'Bico' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Viagem' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Mercado' }));
    expect(onChange).toHaveBeenLastCalledWith(['viagem', 'mercado']);
    fireEvent.click(screen.getByRole('button', { name: 'Viagem' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('"+ Nova tag" cria com Enter sem enviar o formulário em volta, e recusa nome repetido', async () => {
    withTags([mercado]);
    const onChange = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <TagPicker kind="expense" value={[]} onChange={onChange} />
      </form>,
    );

    fireEvent.click(screen.getByRole('button', { name: '+ Nova tag' }));
    const input = screen.getByLabelText('Nome da nova tag');
    fireEvent.change(input, { target: { value: 'mercado' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe uma tag com esse nome.');
    expect(saveTag).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'Farmácia' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(saveTag).toHaveBeenCalledWith(expect.objectContaining({ name: 'Farmácia' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('"+ Nova tag" deixa escolher a cor, e a tag aparece com a bolinha dessa cor, sem #', async () => {
    withTags([mercado]);
    const onChange = vi.fn();
    render(<TagPicker kind="expense" value={[]} onChange={onChange} />);
    expect(screen.queryByText(/#/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '+ Nova tag' }));
    expect(screen.getByRole('radio', { name: 'Verde' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Roxo' }));
    expect(screen.getByRole('radio', { name: 'Roxo' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByLabelText('Nome da nova tag'), { target: { value: 'Farmácia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(saveTag).toHaveBeenCalledWith(expect.objectContaining({ name: 'Farmácia', color: '#4a3aa7' }));
  });

  it('explica a diferença para categoria uma vez, até "Entendi"', () => {
    withTags([mercado], []);
    render(<TagPicker kind="expense" value={[]} onChange={vi.fn()} />);
    expect(screen.getByText(TAG_VS_CATEGORY)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Entendi' }));
    expect(state.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ dismissedNotices: [TAG_NOTICE] }),
    );
  });
});

describe('ExpenseFormSheet com tags', () => {
  const initial: Expense = {
    id: 'feira',
    categoryKind: 'topic',
    topicId: topics[0].id,
    description: 'Feira',
    amount: 80,
    date: '2026-09-10',
    tagIds: ['viagem'],
  };

  function renderForm(props: Partial<React.ComponentProps<typeof ExpenseFormSheet>> = {}) {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onSaveTags = vi.fn().mockResolvedValue(undefined);
    render(
      <ExpenseFormSheet
        month="2026-09"
        topics={topics}
        specialCategories={DEFAULT_SPECIAL_CATEGORY_LABELS}
        initial={initial}
        onClose={vi.fn()}
        onSave={onSave}
        onSaveTags={onSaveTags}
        onDelete={vi.fn()}
        {...props}
      />,
    );
    return { onSave, onSaveTags };
  }

  it('salva as tags junto com o gasto', async () => {
    withTags([mercado, viagem]);
    const { onSave } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Mercado' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((onSave.mock.calls[0][0] as Expense).tagIds).toEqual(['viagem', 'mercado']);
  });

  it('num mês fechado, só as tags mudam', async () => {
    withTags([mercado, viagem]);
    const { onSave, onSaveTags } = renderForm({ tagsOnly: true });

    expect(screen.getByText('Mês fechado: só as tags podem mudar.')).toBeInTheDocument();
    expect(screen.getByLabelText(/valor em reais/i)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mercado' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(onSaveTags).toHaveBeenCalledWith(['viagem', 'mercado']));
    expect(onSave).not.toHaveBeenCalled();
  });
});
