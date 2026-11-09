import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { currentMonthKey, previousMonth, shiftMonth, type Month, type MonthData } from '@/lib/budget';
import { useMonthsToClose } from '@/lib/hooks/useMonthsToClose';
import { ClosePastMonths } from '../ClosePastMonths';
import { MonthContext, type MonthContextValue } from '../MonthContext';

const storage = vi.hoisted(() => ({
  budgetRepository: { closeMonth: vi.fn() },
  fetchMonthsToClose: vi.fn(),
  closeMonthsBefore: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());

vi.mock('@/lib/storage', () => storage);
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ showToast: toast }) }));

const TODAY = currentMonthKey();
const LAST = previousMonth(TODAY);
const OLDER = shiftMonth(TODAY, -2);

function stored(month: Month, closed = false): MonthData {
  return {
    month,
    incomes: [{ id: `i-${month}`, source: 'Salário', amount: 1000 }],
    expenses: [],
    carryIn: { diversos: 0 },
    topicsSnapshot: [{ id: 'diversos', name: 'Diversos', targetPct: 1, order: 0 }],
    closed,
  };
}

const refresh = vi.fn().mockResolvedValue(undefined);

function Screen({ month }: { month: Month }) {
  const toClose = useMonthsToClose(month);
  return (
    <MonthContext.Provider value={{ month, refresh } as unknown as MonthContextValue}>
      {toClose ? <ClosePastMonths {...toClose} /> : <p>Sem botão</p>}
    </MonthContext.Provider>
  );
}

const closeAll = () => screen.findByRole('button', { name: 'Fechar todos os meses anteriores' });

describe('ClosePastMonths', () => {
  beforeEach(() => {
    storage.fetchMonthsToClose.mockResolvedValue([stored(LAST)]);
    storage.budgetRepository.closeMonth.mockResolvedValue(undefined);
    storage.closeMonthsBefore.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('com um mês aberto, mostra só o botão dele', async () => {
    render(<Screen month={TODAY} />);
    expect(await screen.findByRole('button', { name: /^Fechar / })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fechar todos os meses anteriores' })).not.toBeInTheDocument();
    expect(storage.fetchMonthsToClose).toHaveBeenCalledWith(TODAY);
  });

  it('com mais de um mês aberto, oferece fechar todos ou só o último', async () => {
    storage.fetchMonthsToClose.mockResolvedValue([stored(OLDER), stored(LAST)]);
    render(<Screen month={TODAY} />);
    expect(await closeAll()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Fechar só / })).toBeInTheDocument();
  });

  it('um mês já fechado no meio do caminho não conta como aberto', async () => {
    storage.fetchMonthsToClose.mockResolvedValue([stored(OLDER), stored(LAST, true)]);
    render(<Screen month={TODAY} />);
    const button = await screen.findByRole('button', { name: /^Fechar / });
    expect(screen.queryByRole('button', { name: 'Fechar todos os meses anteriores' })).not.toBeInTheDocument();

    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Trazer' }));
    await waitFor(() =>
      expect(storage.budgetRepository.closeMonth).toHaveBeenCalledWith(OLDER, false, false),
    );
  });

  it('não aparece sem nada para fechar', async () => {
    storage.fetchMonthsToClose.mockResolvedValue([]);
    render(<Screen month={TODAY} />);
    await waitFor(() => expect(storage.fetchMonthsToClose).toHaveBeenCalled());
    expect(await screen.findByText('Sem botão')).toBeInTheDocument();
  });

  it('não aparece vendo outro mês', async () => {
    render(<Screen month={LAST} />);
    await new Promise((resolve) => setTimeout(resolve));
    expect(screen.getByText('Sem botão')).toBeInTheDocument();
    expect(storage.fetchMonthsToClose).not.toHaveBeenCalled();
  });

  it('se a leitura falhar, só fica sem o botão', async () => {
    storage.fetchMonthsToClose.mockRejectedValue(new Error('sem conexão'));
    render(<Screen month={TODAY} />);
    await waitFor(() => expect(storage.fetchMonthsToClose).toHaveBeenCalled());
    expect(await screen.findByText('Sem botão')).toBeInTheDocument();
  });

  it('não trazer fecha sem a sobra, some e atualiza o mês na tela', async () => {
    render(<Screen month={TODAY} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Fechar / }));
    storage.fetchMonthsToClose.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'Não trazer' }));

    await waitFor(() => expect(storage.budgetRepository.closeMonth).toHaveBeenCalledWith(LAST, false, true));
    expect(await screen.findByText('Sem botão')).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toMatch(/começa sem o que restou/);
  });

  it('trazer fecha e leva a sobra para o mês de hoje', async () => {
    render(<Screen month={TODAY} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Fechar / }));
    fireEvent.click(screen.getByRole('button', { name: 'Trazer' }));

    await waitFor(() => expect(storage.budgetRepository.closeMonth).toHaveBeenCalledWith(LAST, false, false));
    await waitFor(() => expect(toast.mock.calls[0][0]).toMatch(/O que restou foi para/));
  });

  it('fechar todos mostra a sobra somada e leva tudo para o mês de hoje', async () => {
    storage.fetchMonthsToClose.mockResolvedValue([stored(OLDER), stored(LAST)]);
    render(<Screen month={TODAY} />);
    fireEvent.click(await closeAll());

    expect(screen.getByRole('dialog', { name: 'Fechar 2 meses' })).toBeInTheDocument();
    // 1.000 of each month, with the older one passing to the last.
    expect(screen.getAllByText('R$ 2.000,00').length).toBeGreaterThan(0);

    storage.fetchMonthsToClose.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'Trazer' }));
    await waitFor(() => expect(storage.closeMonthsBefore).toHaveBeenCalledWith(TODAY, false));
    expect(storage.budgetRepository.closeMonth).not.toHaveBeenCalled();
    expect(await screen.findByText('Sem botão')).toBeInTheDocument();
    expect(toast.mock.calls[0][0]).toMatch(/^2 meses fechados\. O que restou foi para/);
  });

  it('fechar todos sem trazer deixa a sobra fora do mês de hoje', async () => {
    storage.fetchMonthsToClose.mockResolvedValue([stored(OLDER), stored(LAST)]);
    render(<Screen month={TODAY} />);
    fireEvent.click(await closeAll());
    fireEvent.click(screen.getByRole('button', { name: 'Não trazer' }));

    await waitFor(() => expect(storage.closeMonthsBefore).toHaveBeenCalledWith(TODAY, true));
  });

  it('fechar só o último deixa o botão do mês que sobrou', async () => {
    storage.fetchMonthsToClose.mockResolvedValue([stored(OLDER), stored(LAST)]);
    render(<Screen month={TODAY} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Fechar só / }));
    storage.fetchMonthsToClose.mockResolvedValue([stored(OLDER), stored(LAST, true)]);
    fireEvent.click(screen.getByRole('button', { name: 'Trazer' }));

    await waitFor(() => expect(storage.budgetRepository.closeMonth).toHaveBeenCalledWith(LAST, false, false));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Fechar só / })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /^Fechar / })).toBeInTheDocument();
  });

  it('se o fechamento falhar, o botão continua e avisa', async () => {
    storage.budgetRepository.closeMonth.mockRejectedValue(new Error('sem conexão'));
    render(<Screen month={TODAY} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Fechar / }));
    fireEvent.click(screen.getByRole('button', { name: 'Trazer' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Não foi possível fechar o mês. Tente de novo.', 'error'),
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
