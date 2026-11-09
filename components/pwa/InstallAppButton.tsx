'use client';

import { useState } from 'react';
import { CheckCircle2, Smartphone } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useInstallApp, type InstallPlatform } from './useInstallApp';

/**
 * "Instalar o app": one tap opens the browser's own install dialog. Where the browser has none
 * (Safari on iPhone, or a browser that hasn't offered it yet) the same tap shows how to do it by
 * hand. Hidden inside the installed app, and on computers that can't install it anyway.
 */
export function InstallAppButton({ className = '' }: { className?: string }) {
  const { ready, standalone, installed, canPrompt, platform, prompt } = useInstallApp();
  const [howToOpen, setHowToOpen] = useState(false);

  if (!ready || standalone) return null;
  if (!canPrompt && !installed && platform === 'desktop') return null;

  if (installed) {
    return (
      <p
        className={`text-success flex items-center justify-center gap-2 text-sm font-medium ${className}`}
        role="status"
      >
        <CheckCircle2 aria-hidden className="h-4 w-4" />
        Instalado. Abra pelo ícone na tela inicial.
      </p>
    );
  }

  async function handleClick() {
    const outcome = await prompt();
    if (outcome === 'unavailable') setHowToOpen(true);
    else setHowToOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        data-tour="instalar-app"
        className={`border-primary text-primary flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold ${className}`}
      >
        <Smartphone aria-hidden className="h-4 w-4" />
        Instalar o app no celular
      </button>
      <BottomSheet
        open={howToOpen}
        onClose={() => setHowToOpen(false)}
        title="Instalar o Capital +"
        confirmDiscard={false}
      >
        <HowToInstall platform={platform} canPrompt={canPrompt} onPrompt={() => void handleClick()} />
      </BottomSheet>
    </>
  );
}

function HowToInstall({
  platform,
  canPrompt,
  onPrompt,
}: {
  platform: InstallPlatform;
  canPrompt: boolean;
  onPrompt: () => void;
}) {
  const steps =
    platform === 'ios'
      ? [
          <>
            No Safari, toque em <strong>Compartilhar</strong> (o quadrado com a seta para cima).
          </>,
          <>
            Escolha <strong>Adicionar à Tela de Início</strong>.
          </>,
          <>
            Toque em <strong>Adicionar</strong>.
          </>,
          <>
            Abra o Capital&nbsp;+ pelo <strong>ícone novo</strong> e entre na sua conta de novo.
          </>,
          <>
            Para receber os avisos, toque no <strong>sino</strong>, na <strong>engrenagem</strong> e em{' '}
            <strong>Ativar notificações</strong>.
          </>,
        ]
      : [
          <>
            No Chrome, toque nos <strong>três pontinhos ⋮</strong> lá em cima.
          </>,
          <>
            Escolha <strong>Instalar app</strong> (ou <strong>Adicionar à tela inicial</strong>).
          </>,
          <>
            Confirme em <strong>Instalar</strong>.
          </>,
        ];

  return (
    <div className="flex flex-col gap-4 text-sm">
      {/* The browser may become ready to install while this is open. */}
      {canPrompt && (
        <button
          type="button"
          onClick={onPrompt}
          className="bg-primary text-primary-foreground min-h-[44px] w-full rounded-lg px-4 font-semibold"
        >
          Instalar agora
        </button>
      )}
      <ol className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <li key={i} className="text-foreground flex items-start gap-3">
            <span className="bg-primary text-primary-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
              {i + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
      {platform !== 'ios' && <p className="text-muted">O ícone aparece na tela inicial, como outro app.</p>}
    </div>
  );
}
