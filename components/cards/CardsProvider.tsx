'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { CreditCard } from '@/lib/budget';
import { isModuleOn } from '@/lib/modules';
import { apiRequest } from '@/lib/storage/apiClient';
import { useSettings } from '@/components/providers/SettingsProvider';

interface CardsContextValue {
  cards: CreditCard[];
  /** The card a new purchase starts on. */
  defaultCard: CreditCard | null;
  /** Reloads the list, after the Cartões screen changed it. */
  refresh: () => Promise<void>;
}

const CardsContext = createContext<CardsContextValue>({
  cards: [],
  defaultCard: null,
  refresh: async () => {},
});

/**
 * The registered cards, for every screen that asks which card a purchase went on — the expense
 * form above all, which is nowhere near the Carteira and its snapshot. Nothing is loaded while
 * the Cartão module is off, and a failure is silent: the card question simply stays the yes/no
 * it has always been.
 */
export function CardsProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const [cards, setCards] = useState<CreditCard[]>([]);
  const enabled = isModuleOn(settings, 'card');

  const refresh = useCallback(async () => {
    if (!enabled) {
      setCards([]);
      return;
    }
    try {
      const { cards: list } = await apiRequest<{ cards: CreditCard[] }>('GET', '/wallet/cards');
      setCards(list);
    } catch {
      setCards([]);
    }
  }, [enabled]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      cards,
      defaultCard: cards.find((card) => card.isDefault) ?? cards[0] ?? null,
      refresh,
    }),
    [cards, refresh],
  );

  return <CardsContext.Provider value={value}>{children}</CardsContext.Provider>;
}

export function useCards(): CardsContextValue {
  return useContext(CardsContext);
}
