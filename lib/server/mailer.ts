import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { notifyOwner } from './alerts';
import { getDb } from './db';
import { allowAttempt } from './rateLimit';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** The same address never gets more than this many e-mails an hour, whoever asks. */
const PER_RECIPIENT_PER_HOUR = 3;

function limitEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

interface Mail {
  to: string;
  subject: string;
  text: string;
}

let transporter: Transporter | undefined;

/** SMTP from the env (Gmail: smtp.gmail.com:465 with an app password). Null when not configured. */
function getTransporter(): Transporter | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 465);
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

/**
 * Whether SMTP answers and takes the login, without sending anything (the automatic tests in
 * Administração). False when SMTP is not configured; throws when it refuses or doesn't answer.
 */
export async function checkMailer(): Promise<boolean> {
  const transport = getTransporter();
  if (!transport) return false;
  await transport.verify();
  return true;
}

/**
 * Whether one more e-mail may go out. The account behind SMTP is a personal Gmail with a daily
 * quota: a script creating accounts for other people's addresses must not be able to spend it
 * (or get it flagged as spam). So there is a ceiling per recipient, per hour and per day
 * (MAIL_MAX_PER_HOUR, MAIL_MAX_PER_DAY); past it the e-mail is dropped and the owner is warned.
 */
function withinQuota(to: string): boolean {
  if (!allowAttempt(`mail:to:${to.trim().toLowerCase()}`, PER_RECIPIENT_PER_HOUR, HOUR_MS)) {
    console.warn(
      `[e-mail] ${to} já recebeu ${PER_RECIPIENT_PER_HOUR} e-mails nesta hora; este não foi enviado.`,
    );
    return false;
  }
  const perHour = limitEnv('MAIL_MAX_PER_HOUR', 30);
  const perDay = limitEnv('MAIL_MAX_PER_DAY', 200);
  if (allowAttempt('mail:hour', perHour, HOUR_MS) && allowAttempt('mail:day', perDay, DAY_MS)) return true;

  console.warn(`[e-mail] limite atingido (${perHour}/hora ou ${perDay}/dia); e-mail para ${to} não enviado.`);
  if (allowAttempt('mail:owner-alert', 1, HOUR_MS)) {
    void notifyOwner(
      getDb(),
      'mail-limit',
      `O Capital + parou de enviar e-mails por enquanto: passou de ${perHour} por hora ou ${perDay} por dia. ` +
        'Pode ser um pico de cadastros ou alguém tentando usar o servidor para mandar spam.',
    ).catch((err: unknown) => console.error('[e-mail] falha ao avisar o dono:', err));
  }
  return false;
}

/**
 * Sends an e-mail, within the quota above. Without SMTP configured (local development) the
 * message is printed to the server log instead, so confirmation and reset links can still be
 * followed.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (!withinQuota(mail.to)) return;
  const smtp = getTransporter();
  if (!smtp) {
    console.info(`[e-mail — SMTP não configurado] Para: ${mail.to}\n${mail.subject}\n\n${mail.text}`);
    return;
  }
  await smtp.sendMail({
    from: process.env.MAIL_FROM || `Capital + <${process.env.SMTP_USER}>`,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
  });
}

export function confirmEmailMessage(to: string, url: string): Mail {
  return {
    to,
    subject: 'Confirme seu e-mail no Capital +',
    text:
      'Olá!\n\nPara ativar sua conta no Capital +, abra o link abaixo:\n\n' +
      `${url}\n\nO link vale por 1 hora. Se você não criou uma conta, ignore este e-mail.`,
  };
}

export function resetPasswordMessage(to: string, url: string): Mail {
  return {
    to,
    subject: 'Redefinir sua senha do Capital +',
    text:
      'Olá!\n\nRecebemos um pedido para redefinir a senha da sua conta no Capital +. ' +
      `Para escolher uma nova senha, abra o link abaixo:\n\n${url}\n\n` +
      'O link vale por 1 hora. Se não foi você, ignore este e-mail: sua senha continua a mesma.',
  };
}
