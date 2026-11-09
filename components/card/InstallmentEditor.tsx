'use client';

import { useEffect, useState } from 'react';
import type { CreditCard, Expense, InstallmentPlan, Month } from '@/lib/budget';
import { isModuleOn } from '@/lib/modules';
import { walletRepository } from '@/lib/storage';
import { useSettings } from '@/components/providers/SettingsProvider';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useToast } from '@/components/ui/Toast';
import { InstallmentFormSheet } from './InstallmentFormSheet';

/**
 * "Parcela 3/10 · Notebook". The count comes from the screen when it has the plan at hand, and
 * from the line's own description ("Notebook 3/10") when it does not.
 */
function installmentLabel(request: Extract<InstallmentEditRequest, { kind: 'scope' }>): string {
  const match = /^(.*?)\s+(\d+)\/(\d+)$/.exec(request.expense.description);
  const name = match ? match[1] : request.expense.description;
  const count = request.count ?? (match ? Number(match[3]) : undefined);
  return count ? `Parcela ${request.number}/${count} · ${name}` : name;
}

/** What the person tapped, and what the editor has to decide about. */
export type InstallmentEditRequest =
  /** An instalment that already is a line of a month: the scope has to be asked first. */
  | { kind: 'scope'; expense: Expense; installmentId: string; number: number; count?: number }
  /** Straight to the whole purchase (a charge with no line of its own, or the Parcelados list). */
  | { kind: 'plan'; installmentId: string };

/** Everything the form needs, when the screen already has it loaded. */
export interface InstallmentEditorData {
  plans: InstallmentPlan[];
  cards: CreditCard[];
  closedMonths: Month[];
  /** The day the server calls "hoje"; absent falls back to the device's own date. */
  today?: string;
}

/**
 * Editing one instalment, with the scope said out loud. Tapping "Notebook 3/10" is ambiguous —
 * it can mean "this month came different" or "the whole purchase was wrong" — so the app asks
 * which one instead of guessing: `Editar a compra toda` opens the plan, `Editar só esta parcela`
 * opens the ordinary expense form for that month alone.
 */
export function InstallmentEditor({
  request,
  data,
  onEditSingle,
  onClose,
  onChanged,
}: {
  request: InstallmentEditRequest;
  /** Skips the extra read when the screen already holds the wallet (the Cartão screen does). */
  data?: InstallmentEditorData;
  /** Opens the plain expense form for one instalment. */
  onEditSingle: (expense: Expense) => void;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const { settings } = useSettings();
  const { showToast } = useToast();
  const [whole, setWhole] = useState(request.kind === 'plan');
  const [loaded, setLoaded] = useState<InstallmentEditorData | null>(data ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!whole || loaded) return;
    let alive = true;
    void walletRepository
      .getSnapshot()
      .then((snapshot) => {
        if (!alive) return;
        setLoaded({
          plans: snapshot.installments,
          cards: snapshot.cards,
          closedMonths: snapshot.closedMonths,
          today: snapshot.today,
        });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [whole, loaded]);

  if (!whole && request.kind === 'scope') {
    const label = installmentLabel(request);
    return (
      <BottomSheet open title="O que você quer editar?" onClose={onClose}>
        <div className="flex flex-col gap-3">
          <p className="text-muted text-sm">{label}</p>
          <button
            type="button"
            onClick={() => setWhole(true)}
            className="border-border min-h-[56px] rounded-xl border px-4 py-3 text-left"
          >
            <span className="text-foreground block text-sm font-semibold">Editar a compra toda</span>
            <span className="text-muted block text-xs">
              Valor, parcelas, categoria e cartão.
            </span>
          </button>
          <button
            type="button"
            onClick={() => onEditSingle(request.expense)}
            className="border-border min-h-[56px] rounded-xl border px-4 py-3 text-left"
          >
            <span className="text-foreground block text-sm font-semibold">Editar só esta parcela</span>
            <span className="text-muted block text-xs">
              Muda só este mês.
            </span>
          </button>
        </div>
      </BottomSheet>
    );
  }

  const plan = loaded?.plans.find((item) => item.id === request.installmentId);

  if (failed || (loaded && !plan)) {
    return (
      <BottomSheet open title="Compra parcelada" onClose={onClose}>
        <p className="text-muted text-sm">
          {failed
            ? 'Não foi possível carregar esta compra. Tente de novo.'
            : 'Esta compra parcelada não existe mais.'}
        </p>
      </BottomSheet>
    );
  }

  if (!plan || !loaded || !settings) {
    return (
      <BottomSheet open title="Compra parcelada" onClose={onClose}>
        <p className="text-muted text-sm">Carregando…</p>
      </BottomSheet>
    );
  }

  return (
    <InstallmentFormSheet
      plan={plan}
      topics={settings.topics}
      specialCategories={settings.specialCategories}
      showReimbursable={isModuleOn(settings, 'reimbursable')}
      cards={loaded.cards}
      closedMonths={loaded.closedMonths}
      today={loaded.today}
      onClose={onClose}
      onSave={async (next) => {
        await walletRepository.saveInstallment(next);
        await onChanged();
        showToast('Compra parcelada salva.');
      }}
      onDelete={async (target) => {
        await walletRepository.deleteInstallment(target.id);
        await onChanged();
        showToast('Compra parcelada excluída.');
      }}
    />
  );
}
