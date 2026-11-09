import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestingFact } from '@/lib/motivation';
import { FactsCard } from '../FactsCard';

const repository = vi.hoisted(() => ({
  listFacts: vi.fn(),
  createFact: vi.fn(),
  updateFact: vi.fn(),
  deleteFact: vi.fn(),
}));
const confirm = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());

vi.mock('@/lib/storage/admin', () => ({ adminRepository: repository }));
vi.mock('@/components/ui/ConfirmSheet', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ showToast }) }));

const FACTS: InvestingFact[] = [
  { id: 'a', text: 'Primeira frase', detail: 'Explicação 1', sourceLabel: 'Fonte 1', sourceUrl: 'https://a.com.br' },
  { id: 'b', text: 'Segunda frase', detail: 'Explicação 2', sourceLabel: 'Fonte 2', sourceUrl: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  repository.listFacts.mockResolvedValue({ facts: FACTS });
});

describe('FactsCard (frases na Administração)', () => {
  it('lista todas as frases', async () => {
    render(<FactsCard />);

    expect(await screen.findByRole('button', { name: 'Primeira frase' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Segunda frase' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Você sabia? (2)' })).toBeTruthy();
  });

  it('edita uma frase e mostra a nova na lista', async () => {
    repository.updateFact.mockImplementation(async (id: string, input: object) => ({ fact: { id, ...input } }));
    render(<FactsCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Primeira frase' }));
    fireEvent.change(screen.getByLabelText('Frase'), { target: { value: 'Frase nova' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('button', { name: 'Frase nova' })).toBeTruthy();
    expect(repository.updateFact).toHaveBeenCalledWith('a', {
      text: 'Frase nova',
      detail: 'Explicação 1',
      sourceLabel: 'Fonte 1',
      sourceUrl: 'https://a.com.br',
    });
  });

  it('cria uma frase no fim da lista, sem link', async () => {
    repository.createFact.mockImplementation(async (input: object) => ({ fact: { id: 'c', ...input } }));
    render(<FactsCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Nova frase' }));
    fireEvent.change(screen.getByLabelText('Frase'), { target: { value: 'Terceira frase' } });
    fireEvent.change(screen.getByLabelText('Explicação'), { target: { value: 'Porque sim' } });
    fireEvent.change(screen.getByLabelText('Fonte'), { target: { value: 'Conta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('button', { name: 'Terceira frase' })).toBeTruthy();
    expect(repository.createFact).toHaveBeenCalledWith({
      text: 'Terceira frase',
      detail: 'Porque sim',
      sourceLabel: 'Conta',
      sourceUrl: null,
    });
  });

  it('exclui depois de confirmar', async () => {
    confirm.mockResolvedValue(true);
    repository.deleteFact.mockResolvedValue({ deleted: true });
    render(<FactsCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Segunda frase' }));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir frase' }));

    await vi.waitFor(() => expect(repository.deleteFact).toHaveBeenCalledWith('b'));
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Segunda frase' })).toBeNull());
  });

  it('sem confirmar, a frase fica', async () => {
    confirm.mockResolvedValue(false);
    render(<FactsCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Segunda frase' }));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir frase' }));

    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(repository.deleteFact).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect((screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it('explica quando o link não é https, sem mandar nada ao servidor', async () => {
    render(<FactsCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Primeira frase' }));
    fireEvent.change(screen.getByLabelText('Link da fonte (opcional)'), {
      target: { value: 'http://inseguro.com.br' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Use um link que comece com https://.');
    expect(repository.updateFact).not.toHaveBeenCalled();
  });

  it('mostra na própria folha o erro do servidor', async () => {
    repository.updateFact.mockRejectedValue(new Error('Use um link que comece com https://.'));
    render(<FactsCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Primeira frase' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeTruthy();
  });
});
