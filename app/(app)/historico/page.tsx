'use client';

import { Suspense } from 'react';
import { HistoricoScreen } from '@/components/screens/HistoricoScreen';

export default function HistoricoPage() {
  // The screen reads its tab from the address ("?aba=investimentos").
  return (
    <Suspense>
      <HistoricoScreen />
    </Suspense>
  );
}
