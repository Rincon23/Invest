'use client';

import { UNASSIGNED_CARD_LABEL, type CreditCard } from '@/lib/budget';
import { Chip } from './Chip';

/**
 * Which card a purchase went on. It shows up wherever something is marked as a card purchase —
 * the expense form, the recurring templates, the instalment plans — so the bill of each card
 * knows what belongs to it.
 *
 * "Não informar" is always there, next to the cards: nothing in Capital is compulsory, and
 * choosing it is a first-class answer, not a gap. Those purchases form the "Não informado" bill,
 * which is paid like any other. With no card registered there is nothing to pick, so the whole
 * question disappears and the card answer stays the plain yes/no it has always been.
 */
export function CardPicker({
  cards,
  value,
  onChange,
  label = 'Em qual cartão?',
  tourAnchor,
}: {
  cards: CreditCard[];
  value: string | undefined;
  onChange: (cardId: string | undefined) => void;
  label?: string;
  tourAnchor?: string;
}) {
  if (cards.length === 0) return null;

  return (
    <div data-tour={tourAnchor}>
      <p className="text-muted mb-2 text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">
        {cards.map((card) => (
          <Chip
            key={card.id}
            label={card.name}
            selected={value === card.id}
            onClick={() => onChange(card.id)}
          />
        ))}
        <Chip label="Não informar" selected={value === undefined} onClick={() => onChange(undefined)} />
      </div>
      {value === undefined && (
        <p className="text-muted mt-2 text-xs">
          Entra na fatura &ldquo;{UNASSIGNED_CARD_LABEL}&rdquo;, que só sai quando for paga.
        </p>
      )}
    </div>
  );
}
