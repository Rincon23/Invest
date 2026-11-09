'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Lightbulb, Pencil, Plus } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useConfirm } from '@/components/ui/ConfirmSheet';
import { useToast } from '@/components/ui/Toast';
import { FACT_LIMITS, type FactInput, type InvestingFact } from '@/lib/motivation';
import { adminRepository } from '@/lib/storage/admin';
import { toStorageErrorMessage } from '@/lib/storage/errors';
import { AdminCard } from './AdminCard';

const inputClass =
  'border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2';
const labelClass = 'text-muted flex flex-col gap-1.5 text-sm font-medium';

const EMPTY: InvestingFact = { id: '', text: '', detail: '', sourceLabel: '', sourceUrl: null };

/**
 * Administração: every "Você sabia?", in the order they take turns (one a day on the Missões bar and
 * in the app drawer, one a week on the phone). A tap edits one; the change reaches everyone at once.
 */
export function FactsCard() {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [facts, setFacts] = useState<InvestingFact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The fact on the sheet; one without an id is a new one. */
  const [editing, setEditing] = useState<InvestingFact | null>(null);

  useEffect(() => {
    adminRepository
      .listFacts()
      .then(({ facts: list }) => setFacts(list))
      .catch((err) => setError(toStorageErrorMessage(err, 'Não foi possível carregar as frases.')));
  }, []);

  async function save(input: FactInput) {
    const id = editing?.id;
    const { fact } = id ? await adminRepository.updateFact(id, input) : await adminRepository.createFact(input);
    setFacts((current) =>
      id ? (current ?? []).map((item) => (item.id === id ? fact : item)) : [...(current ?? []), fact],
    );
    setEditing(null);
    showToast(id ? 'Frase salva.' : 'Frase criada.');
  }

  async function remove(target: InvestingFact) {
    const confirmed = await confirm({
      title: 'Excluir frase?',
      message: 'Ela para de aparecer para todo mundo.',
      confirmLabel: 'Excluir',
      cancelLabel: 'Manter',
      destructive: true,
    });
    if (!confirmed) return;
    await adminRepository.deleteFact(target.id);
    setFacts((current) => (current ?? []).filter((item) => item.id !== target.id));
    setEditing(null);
    showToast('Frase excluída.');
  }

  return (
    <AdminCard title={`Você sabia?${facts ? ` (${facts.length})` : ''}`} icon={Lightbulb} tone="green">
      <p className="text-muted text-sm">Uma por dia nas Missões e uma por semana no celular.</p>
      {error && <p className="bg-danger-bg text-danger rounded-lg px-3 py-2 text-sm">{error}</p>}
      {!facts && !error && <p className="text-muted text-sm">Carregando…</p>}
      {facts && (
        <>
          <ul className="divide-border -mx-1 flex flex-col divide-y">
            {facts.map((fact) => (
              <li key={fact.id}>
                <button
                  type="button"
                  onClick={() => setEditing(fact)}
                  className="flex min-h-[44px] w-full items-center gap-3 px-1 py-3 text-left"
                >
                  <span className="text-foreground min-w-0 flex-1 text-sm">{fact.text}</span>
                  <Pencil aria-hidden className="text-muted h-4 w-4 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setEditing(EMPTY)}
            className="border-primary text-primary flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold"
          >
            <Plus aria-hidden className="h-4 w-4" />
            Nova frase
          </button>
        </>
      )}

      {editing && (
        <FactSheet
          key={editing.id}
          fact={editing}
          canDelete={Boolean(editing.id) && (facts?.length ?? 0) > 1}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={() => remove(editing)}
        />
      )}
    </AdminCard>
  );
}

function FactSheet({
  fact,
  canDelete,
  onClose,
  onSave,
  onDelete,
}: {
  fact: InvestingFact;
  canDelete: boolean;
  onClose: () => void;
  onSave: (input: FactInput) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [text, setText] = useState(fact.text);
  const [detail, setDetail] = useState(fact.detail);
  const [sourceLabel, setSourceLabel] = useState(fact.sourceLabel);
  const [sourceUrl, setSourceUrl] = useState(fact.sourceUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(toStorageErrorMessage(err, 'Não foi possível salvar. Tente de novo.'));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const link = sourceUrl.trim();
    if (link && !link.startsWith('https://')) {
      setError('Use um link que comece com https://.');
      return;
    }
    void run(() => onSave({ text, detail, sourceLabel, sourceUrl: link || null }));
  }

  return (
    <BottomSheet open title={fact.id ? 'Editar frase' : 'Nova frase'} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className={labelClass}>
          Frase
          <textarea
            required
            rows={3}
            maxLength={FACT_LIMITS.text}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Explicação
          <textarea
            required
            rows={3}
            maxLength={FACT_LIMITS.detail}
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Fonte
          <input
            required
            type="text"
            maxLength={FACT_LIMITS.sourceLabel}
            value={sourceLabel}
            onChange={(event) => setSourceLabel(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Link da fonte (opcional)
          <input
            type="url"
            inputMode="url"
            maxLength={FACT_LIMITS.sourceUrl}
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://"
            className={inputClass}
          />
        </label>

        {error && (
          <p role="alert" className="bg-danger-bg text-danger rounded-lg px-3 py-2 text-sm">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
        {canDelete && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(onDelete)}
            className="text-danger min-h-[44px] rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
          >
            Excluir frase
          </button>
        )}
      </form>
    </BottomSheet>
  );
}
