'use client';

import { Suspense } from 'react';
import { BankReviewScreen } from '@/components/screens/BankReviewScreen';

export default function Page() {
  // The screen reads its tab and month from the address ("?tipo=recebimentos&mes=2026-09").
  return (
    <Suspense>
      <BankReviewScreen />
    </Suspense>
  );
}
