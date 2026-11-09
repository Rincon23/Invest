import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_SPECIAL_CATEGORY_LABELS, type Expense, type TopicConfig } from '@/lib/budget';
import { ExpenseFormSheet } from '../ExpenseFormSheet';

const TOPICS: TopicConfig[] = [
  { id: 'diversos', name: 'Diversos', targetPct: 0.5, order: 0 },
  { id: 'metas', name: 'Metas', targetPct: 0.5, order: 1 },
];

function renderSheet(props: Partial<ComponentProps<typeof ExpenseFormSheet>> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <ExpenseFormSheet
      month="2026-09"
      topics={TOPICS}
      specialCategories={DEFAULT_SPECIAL_CATEGORY_LABELS}
      onClose={vi.fn()}
      onSave={onSave}
      {...props}
    />,
  );
  return { onSave };
}

describe('ExpenseFormSheet e a categoria "A receber"', () => {
  it('não mostra a categoria enquanto o módulo está desligado', () => {
    renderSheet();
    expect(screen.queryByRole('button', { name: 'A receber' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Custos Fixos' })).toBeInTheDocument();
  });

  it('mostra a categoria e a explicação quando o módulo está ligado', async () => {
    const { onSave } = renderSheet({ reimbursableEnabled: true });

    fireEvent.click(screen.getByRole('button', { name: 'A receber' }));
    expect(screen.getByText(/alguém vai te devolver/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/valor em reais/i), { target: { value: '73,00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as Expense;
    expect(saved.categoryKind).toBe('reimbursable');
    expect(saved.topicId).toBeUndefined();
    expect(saved.amount).toBe(73);
  });

  it('empresta dinheiro sem cartão: a pergunta do cartão fica livre', async () => {
    const { onSave } = renderSheet({ reimbursableEnabled: true });

    fireEvent.click(screen.getByRole('button', { name: 'A receber' }));
    const card = screen.getByRole('checkbox');
    // Emprestar em dinheiro é a mesma coisa: a pessoa decide se foi no cartão ou não.
    expect(card).not.toBeChecked();
    expect(card).not.toBeDisabled();

    fireEvent.change(screen.getByLabelText(/valor em reais/i), { target: { value: '50,00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as Expense;
    expect(saved.categoryKind).toBe('reimbursable');
    expect(saved.singleInstallmentCard).toBe(false);

    fireEvent.click(card);
    expect(card).toBeChecked();
  });

  it('continua editável quando o módulo é desligado depois do lançamento', () => {
    const existing: Expense = {
      id: 'r1',
      categoryKind: 'reimbursable',
      description: 'Compra para outra pessoa',
      amount: 73,
      date: '2026-09-05',
      singleInstallmentCard: true,
    };
    renderSheet({ initial: existing, reimbursableEnabled: false });
    expect(screen.getByRole('button', { name: 'A receber' })).toBeInTheDocument();
  });

  it('usa o rótulo que o usuário escolheu para a categoria', () => {
    renderSheet({
      reimbursableEnabled: true,
      specialCategories: { ...DEFAULT_SPECIAL_CATEGORY_LABELS, reimbursable: 'Me devem' },
    });
    expect(screen.getByRole('button', { name: 'Me devem' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'A receber' })).not.toBeInTheDocument();
  });
});

describe('ExpenseFormSheet sem o módulo Cartão de crédito', () => {
  it('não pergunta se a compra foi no cartão e salva sem marcar', async () => {
    const { onSave } = renderSheet({ cardEnabled: false });
    expect(screen.queryByText('A compra foi no cartão?')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/valor em reais/i), { target: { value: '20,00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((onSave.mock.calls[0][0] as Expense).singleInstallmentCard).toBe(false);
  });

  it('mantém marcado no cartão um gasto antigo que já estava', async () => {
    const existing: Expense = {
      id: 'e1',
      categoryKind: 'topic',
      topicId: 'diversos',
      description: 'Mercado',
      amount: 50,
      date: '2026-09-03',
      singleInstallmentCard: true,
    };
    const { onSave } = renderSheet({ cardEnabled: false, initial: existing });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((onSave.mock.calls[0][0] as Expense).singleInstallmentCard).toBe(true);
  });
});

describe('ExpenseFormSheet com a data de um mês anterior', () => {
  it('diz que o gasto vai para o mês fechado da data e que a sobra trazida diminui', async () => {
    const lateDestinationOf = vi
      .fn()
      .mockResolvedValue({ month: '2026-08', closed: true, reachesFrom: true });
    renderSheet({ lateDestinationOf });

    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-08-30' } });

    expect(
      await screen.findByText(
        'Agosto já está fechado, mas o gasto entra nele assim mesmo e sai das categorias de lá. Como o que restou veio para setembro, setembro diminui junto.',
      ),
    ).toBeInTheDocument();
    expect(lateDestinationOf).toHaveBeenCalledWith('2026-08-30');
  });

  it('sem a sobra trazida, diz que o mês de agora não muda', async () => {
    renderSheet({
      lateDestinationOf: vi.fn().mockResolvedValue({ month: '2026-08', closed: true, reachesFrom: false }),
    });
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-08-30' } });
    expect(await screen.findByText(/então setembro não muda\.$/)).toBeInTheDocument();
  });

  it('um mês que nunca foi usado só leva o aviso de sempre', async () => {
    const lateDestinationOf = vi.fn().mockResolvedValue(null);
    renderSheet({ lateDestinationOf });
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-08-30' } });
    await waitFor(() => expect(lateDestinationOf).toHaveBeenCalled());
    expect(screen.getByText('Essa data está fora de 2026-09. Tudo bem, é só um aviso.')).toBeInTheDocument();
  });
});
