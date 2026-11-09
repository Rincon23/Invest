import { redirect } from 'next/navigation';

/** The Carteira hub is gone: each of its modules has its own entry and a card on Início. */
export default function Page() {
  redirect('/');
}
