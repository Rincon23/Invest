'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { APIError } from 'better-auth/api';
import { joinName } from '@/lib/auth/names';
import { getAuth } from '@/lib/server/auth';
import { clientIp } from '@/lib/server/clientIp';
import { homeTemplateEmail } from '@/lib/server/homeTemplate';
import { isPasswordPwned } from '@/lib/server/pwnedPasswords';
import { allowAttempt } from '@/lib/server/rateLimit';
import {
  ensureHomeTemplateAccount,
  ensureTestAccount,
  resetTestAccount,
  testAccountEmail,
} from '@/lib/server/testAccount';

export interface AuthActionState {
  error?: string;
  /** A success that produced no session (email confirmation / password reset flows). */
  notice?: 'check-email' | 'check-email-resent' | 'reset-sent';
  /** Echoed back so the form keeps the typed address and notices can show it. */
  email?: string;
  /** Echoed back too, so a refused sign-up keeps the name already typed. */
  firstName?: string;
  lastName?: string;
}

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const MINUTE = 60 * 1000;
const FIVE_MINUTES = 5 * MINUTE;
const FIFTEEN_MINUTES = 15 * MINUTE;
const HOUR = 60 * MINUTE;
const TOO_MANY_ATTEMPTS = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
const PWNED_PASSWORD =
  'Essa senha já apareceu em vazamentos de dados na internet, então é das primeiras que um invasor tenta. Escolha outra.';
/** Where the confirmation link lands once Better Auth has checked it (see app/auth/confirmado). */
const EMAIL_CONFIRMED_PATH = '/auth/confirmado';

function readCredentials(formData: FormData): { email: string; password: string } {
  return {
    email: String(formData.get('email') ?? '')
      .trim()
      .slice(0, 254),
    password: String(formData.get('password') ?? '').slice(0, MAX_PASSWORD + 1),
  };
}

function errorCode(err: unknown): string | undefined {
  if (!(err instanceof APIError)) return undefined;
  return (err.body as { code?: string } | undefined)?.code;
}

/** Every limit must allow the attempt (all are counted, so none can be dodged by varying another). */
function allowAll(...checks: [key: string, limit: number, windowMs: number][]): boolean {
  let allowed = true;
  for (const [key, limit, windowMs] of checks) {
    if (!allowAttempt(key, limit, windowMs)) allowed = false;
  }
  return allowed;
}

function passwordLengthError(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `A senha precisa de pelo menos ${MIN_PASSWORD} caracteres.`;
  if (password.length > MAX_PASSWORD) return `A senha pode ter no máximo ${MAX_PASSWORD} caracteres.`;
  return null;
}

export async function signIn(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const { email, password } = readCredentials(formData);
  if (!email || !password) return { error: 'Informe e-mail e senha.', email };

  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);
  const account = email.toLowerCase();
  // Per address and IP (someone mistyping), per address from anywhere (a botnet guessing one
  // person's password) and per IP across addresses (one machine trying a leaked list).
  if (
    !allowAll(
      [`sign-in:${ip}:${account}`, 5, FIVE_MINUTES],
      [`sign-in:account:${account}`, 10, FIFTEEN_MINUTES],
      [`sign-in:ip:${ip}`, 30, FIFTEEN_MINUTES],
    )
  ) {
    return { error: TOO_MANY_ATTEMPTS, email };
  }

  // The first-access test account (see lib/server/testAccount.ts) opens as a brand-new account every time.
  const testAccount = account === testAccountEmail();
  try {
    if (testAccount) await ensureTestAccount(account, password);
    // The Início template (see lib/server/homeTemplate.ts) is created on its first sign-in too.
    if (account === homeTemplateEmail()) await ensureHomeTemplateAccount(account, password);
    await getAuth().api.signInEmail({
      body: { email, password, rememberMe: true },
      headers: requestHeaders,
    });
    if (testAccount) await resetTestAccount(account);
  } catch (err) {
    if (errorCode(err) === 'EMAIL_NOT_VERIFIED') {
      return {
        error: 'Confirme seu e-mail antes de entrar — verifique sua caixa de entrada.',
        email,
      };
    }
    if (err instanceof APIError) return { error: 'E-mail ou senha incorretos.', email };
    console.error('[auth] falha ao entrar:', err);
    return { error: 'Não foi possível entrar agora. Tente de novo.', email };
  }

  redirect('/');
}

export async function signUp(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const { email, password } = readCredentials(formData);
  const firstName = String(formData.get('firstName') ?? '').slice(0, 200);
  const lastName = String(formData.get('lastName') ?? '').slice(0, 200);
  const typed = { email, firstName, lastName };
  // The app calls the person by the first name (greeting, reminders), so it asks for it up front.
  const name = lastName.trim() ? joinName(firstName, lastName) : null;
  if (!name) return { error: 'Informe seu nome e sobrenome.', ...typed };
  if (!email) return { error: 'Informe um e-mail.', ...typed };
  const lengthError = passwordLengthError(password);
  if (lengthError) return { error: lengthError, ...typed };
  // Every sign-up sends an e-mail: few per IP, so nobody can script accounts for other addresses.
  if (!allowAttempt(`sign-up:${clientIp(await headers())}`, 5, HOUR)) {
    return { error: TOO_MANY_ATTEMPTS, ...typed };
  }
  if (await isPasswordPwned(password)) return { error: PWNED_PASSWORD, ...typed };

  try {
    await getAuth().api.signUpEmail({
      body: { email, password, name, callbackURL: EMAIL_CONFIRMED_PATH },
    });
  } catch (err) {
    const code = errorCode(err);
    // Don't reveal which addresses already have an account.
    if (code === 'USER_ALREADY_EXISTS' || code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
      return { notice: 'check-email', email };
    }
    if (err instanceof APIError) {
      return { error: 'Não foi possível criar a conta. Verifique o e-mail e a senha.', ...typed };
    }
    console.error('[auth] falha ao criar conta:', err);
    return { error: 'Não foi possível criar a conta agora. Tente de novo.', ...typed };
  }

  // Email confirmation is on: there is no session yet.
  return { notice: 'check-email', email };
}

export async function resendConfirmation(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .slice(0, 254);
  if (!email) return { error: 'Informe um e-mail.' };
  if (
    !allowAll(
      [`resend:${email.toLowerCase()}`, 3, FIVE_MINUTES],
      [`resend:ip:${clientIp(await headers())}`, 10, HOUR],
    )
  ) {
    return { error: TOO_MANY_ATTEMPTS, email };
  }

  try {
    await getAuth().api.sendVerificationEmail({
      body: { email, callbackURL: EMAIL_CONFIRMED_PATH },
    });
  } catch (err) {
    if (!(err instanceof APIError)) console.error('[auth] falha ao reenviar a confirmação:', err);
    return { error: 'Não foi possível reenviar agora. Tente mais tarde.', email };
  }
  return { notice: 'check-email-resent', email };
}

export async function requestPasswordReset(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .slice(0, 254);
  if (!email) return { error: 'Informe seu e-mail.' };

  if (
    allowAll(
      [`reset:${email.toLowerCase()}`, 3, FIVE_MINUTES],
      [`reset:ip:${clientIp(await headers())}`, 10, HOUR],
    )
  ) {
    try {
      await getAuth().api.requestPasswordReset({ body: { email, redirectTo: '/redefinir-senha' } });
    } catch (err) {
      console.error('[auth] falha ao pedir a redefinição de senha:', err);
    }
  }

  // Always report success — don't reveal which addresses have accounts.
  return { notice: 'reset-sent', email };
}

/** Sets the new password from the reset link (the token comes from /redefinir-senha?token=…). */
export async function resetPassword(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const token = String(formData.get('token') ?? '').slice(0, 500);
  const password = String(formData.get('password') ?? '').slice(0, MAX_PASSWORD + 1);
  const lengthError = passwordLengthError(password);
  if (lengthError) return { error: lengthError };
  if (!token) return { error: 'Link inválido ou expirado. Peça um novo na tela de acesso.' };
  if (!allowAttempt(`reset-password:ip:${clientIp(await headers())}`, 10, FIFTEEN_MINUTES)) {
    return { error: TOO_MANY_ATTEMPTS };
  }
  if (await isPasswordPwned(password)) return { error: PWNED_PASSWORD };

  try {
    await getAuth().api.resetPassword({ body: { newPassword: password, token } });
  } catch (err) {
    if (!(err instanceof APIError)) console.error('[auth] falha ao redefinir a senha:', err);
    return { error: 'Não foi possível atualizar a senha. O link pode ter expirado.' };
  }

  redirect('/login?senha=redefinida');
}

export async function signOut(): Promise<void> {
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch (err) {
    console.error('[auth] falha ao sair:', err);
  }
  redirect('/login');
}

export interface DeleteAccountState {
  error?: string;
}

export interface UpdateNameState {
  error?: string;
  /** The name just saved, so the form can say so. */
  saved?: string;
}

/** "Seu nome" in Configurações: the name and surname the app calls the person by. */
export async function updateName(_prev: UpdateNameState, formData: FormData): Promise<UpdateNameState> {
  const name = joinName(String(formData.get('firstName') ?? ''), String(formData.get('lastName') ?? ''));
  if (!name) return { error: 'Informe pelo menos o seu nome (até 60 letras em cada campo).' };

  const requestHeaders = await headers();
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect('/login');
  if (!allowAttempt(`update-name:${session.user.id}`, 10, FIFTEEN_MINUTES))
    return { error: TOO_MANY_ATTEMPTS };

  try {
    await auth.api.updateUser({ body: { name }, headers: requestHeaders });
  } catch (err) {
    console.error('[auth] falha ao salvar o nome:', err);
    return { error: 'Não foi possível salvar o nome agora. Tente de novo.' };
  }
  return { saved: name };
}

/**
 * "Excluir minha conta": asks for the password again, then deletes the user. Every table hangs
 * from `users` with ON DELETE CASCADE, so all the account's data goes too.
 */
export async function deleteAccount(
  _prev: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const password = String(formData.get('password') ?? '').slice(0, MAX_PASSWORD + 1);
  if (!password) return { error: 'Digite a sua senha para confirmar.' };

  const requestHeaders = await headers();
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect('/login');
  if (!allowAttempt(`delete-account:${session.user.id}`, 5, FIFTEEN_MINUTES)) {
    return { error: TOO_MANY_ATTEMPTS };
  }

  try {
    await auth.api.deleteUser({ body: { password }, headers: requestHeaders });
  } catch (err) {
    if (err instanceof APIError) return { error: 'Senha incorreta. A conta não foi excluída.' };
    console.error('[auth] falha ao excluir a conta:', err);
    return { error: 'Não foi possível excluir a conta agora. Tente de novo.' };
  }

  redirect('/login?conta=excluida');
}
