import type { ReactNode } from 'react';
import { WalletProvider } from '@/components/wallet/WalletProvider';

/** Every Carteira screen shares one snapshot of the wallet (see WalletProvider). */
export default function CarteiraLayout({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
