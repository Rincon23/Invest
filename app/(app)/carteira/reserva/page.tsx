import { redirect } from 'next/navigation';

/** The Reserva investida is now the "Investida" tab of the Reserva. */
export default function Page() {
  redirect('/carteira/caixa?aba=investida');
}
