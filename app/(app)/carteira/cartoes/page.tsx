import { redirect } from 'next/navigation';

/** "Cartões" is part of the single Cartão module now; old links (and the bell's) still work. */
export default function Page() {
  redirect('/cartao');
}
