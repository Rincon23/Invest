import { redirect } from 'next/navigation';

/** "Parcelados" is a tab of the single Cartão module now; old links still work. */
export default function Page() {
  redirect('/cartao?aba=parcelados');
}
