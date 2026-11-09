import type { ReactNode } from 'react';
import { WalletProvider } from '@/components/wallet/WalletProvider';

/** The Cartão screen reads the whole wallet once (cards, bills, plans) — see WalletProvider. */
export default function CartaoLayout({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
