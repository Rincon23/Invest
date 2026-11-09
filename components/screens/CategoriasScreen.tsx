'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Percent } from 'lucide-react';
import { formatMonthLabel, nextMonth } from '@/lib/budget';
import { useMonthsToClose } from '@/lib/hooks/useMonthsToClose';
import { PageHeader } from '@/components/layout/PageHeader';
import { ModuleGate } from '@/components/modules/ModuleGate';
import { ModuleHelpButton, ModuleSettingsButton } from '@/components/modules/ModuleHelpButton';
import { ModuleSettingsSheet } from '@/components/modules/ModuleSettingsSheet';
import { useHomeHref } from '@/components/modules/useHomeHref';
import { useModuleIntro } from '@/components/modules/useModuleIntro';
import { ClosedMonthBanner } from '@/components/month/ClosedMonthBanner';
import { CloseMonthSheet, closedMonthMessage } from '@/components/month/CloseMonthSheet';
import { ClosePastMonths } from '@/components/month/ClosePastMonths';
import { FixedCostsCard } from '@/components/month/FixedCostsCard';
import { useMonthContext } from '@/components/month/MonthContext';
import { MonthSwipe } from '@/components/month/MonthSwipe';
import { MonthSwitcher } from '@/components/month/MonthSwitcher';
import { SummaryHeader } from '@/components/month/SummaryHeader';
import { TopicCard } from '@/components/month/TopicCard';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { useSettings } from '@/components/providers/SettingsProvider';
import { CategoriesSettings } from '@/components/settings/CategoriesSettings';
import { useToast } from '@/components/ui/Toast';

/** "Gastos por categoria": the month's targets, what is left in each category and closing the month. */
export function CategoriasScreen() {
  return (
    <ModuleGate module="budget">
      <Categorias />
    </ModuleGate>
  );
}

function Categorias() {
  const backHref = useHomeHref();
  const { month, summary, monthData, loading, error, closeMonth, refresh } = useMonthContext();
  const { settings, saveSettings } = useSettings();
  const toClose = useMonthsToClose(month, settings?.topics);
  const { showToast } = useToast();
  const router = useRouter();
  const [closing, setClosing] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  /** "Me ajude com as %": the same questions as the first visit, without the tour after. */
  const [helping, setHelping] = useState(false);
  // First visit: the questions (income, fixed and unforeseen costs, and the percentages).
  const { setupOpen, finishSetup } = useModuleIntro('budget', {
    ready: !loading && !!summary && !!settings,
    withSetup: true,
  });

  // The mission "Ajustar suas categorias" comes with ?ajustar=1: the questions open right away
  // (on a first visit they are already opening by themselves).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('ajustar') !== '1') return;
    params.delete('ajustar');
    const query = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHelping(true);
  }, []);

  /** Closes the month with the answer about the leftovers and opens the next one, then goes to it. */
  async function handleCloseMonth(bringLeftovers: boolean) {
    try {
      await closeMonth(true, !bringLeftovers);
      setClosing(false);
      if (summary) showToast(closedMonthMessage(summary, nextMonth(month), bringLeftovers));
      router.push(`/mes/${nextMonth(month)}/categorias`);
    } catch {
      showToast('Não foi possível fechar o mês. Tente de novo.', 'error');
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 pb-10">
      <PageHeader
        title="Categorias"
        subtitle={formatMonthLabel(month)}
        backHref={backHref}
        action={
          <>
            <ModuleHelpButton module="budget" />
            <ModuleSettingsButton
              module="budget"
              tourAnchor="categorias-config"
              onClick={() => setConfiguring(true)}
            />
          </>
        }
      />

      <MonthSwipe
        month={month}
        onMonth={(next) => router.replace(`/mes/${next}/categorias`)}
        className="flex flex-col gap-4 px-4"
      >
        <MonthSwitcher month={month} path="/categorias" />

        {error && <p className="bg-danger-bg text-danger rounded-lg px-3 py-2 text-sm">{error}</p>}

        {loading || !summary || !settings ? (
          <p className="text-muted py-16 text-center">Carregando…</p>
        ) : (
          <>
            {monthData?.closed && (
              <div data-tour="fechar-mes">
                <ClosedMonthBanner />
              </div>
            )}

            {toClose && (
              <div data-tour="fechar-mes">
                <ClosePastMonths {...toClose} />
              </div>
            )}

            <SummaryHeader summary={summary} />

            <section className="flex flex-col gap-3" aria-labelledby="categorias-titulo">
              <div className="flex items-center justify-between gap-2">
                <h2 id="categorias-titulo" className="text-muted text-sm font-semibold">
                  Suas categorias
                </h2>
                <button
                  type="button"
                  onClick={() => setHelping(true)}
                  data-tour="categorias-porcentagens"
                  className="border-border text-primary hover:bg-card inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 text-sm font-semibold"
                >
                  <Percent aria-hidden className="h-4 w-4" />
                  Me ajude com as %
                </button>
              </div>
              <div className="flex flex-col gap-3" data-tour="categorias">
                {summary.topics.map((topic) => (
                  <TopicCard key={topic.topicId} month={month} topic={topic} />
                ))}
              </div>
            </section>

            <div data-tour="custos-fixos">
              <FixedCostsCard
                summary={summary}
                specialCategories={settings.specialCategories}
                specialCategoryColors={settings.specialCategoryColors}
              />
            </div>

            {/* One at a time: with past months open, this one would close the month just begun. */}
            {!monthData?.closed && !toClose && (
              <button
                type="button"
                onClick={() => setClosing(true)}
                data-tour="fechar-mes"
                className="border-border text-muted hover:text-foreground min-h-[44px] self-start rounded-lg border px-4 py-2 text-sm font-medium"
              >
                Fechar mês
              </button>
            )}
          </>
        )}
      </MonthSwipe>

      {closing && summary && (
        <CloseMonthSheet
          summary={summary}
          target={nextMonth(month)}
          onConfirm={handleCloseMonth}
          onCancel={() => {
            setClosing(false);
            showToast('Fechamento cancelado. Nenhuma alteração foi feita.', 'info');
          }}
        />
      )}

      {configuring && (
        <ModuleSettingsSheet module="budget" onClose={() => setConfiguring(false)}>
          <CategoriesSettings withTargets onSaved={() => setConfiguring(false)} />
        </ModuleSettingsSheet>
      )}

      {setupOpen && settings && (
        <OnboardingWizard
          settings={settings}
          saveSettings={saveSettings}
          // Skipping the first visit's questions leaves for the Início, not for a Categorias still unset.
          onSkip={() => {
            setHelping(false);
            finishSetup();
            router.push(backHref);
          }}
          onComplete={() => {
            void refresh();
            setHelping(false);
            finishSetup();
          }}
        />
      )}

      {helping && !setupOpen && settings && (
        <OnboardingWizard
          settings={settings}
          saveSettings={saveSettings}
          onSkip={() => setHelping(false)}
          onComplete={() => {
            setHelping(false);
            void refresh();
            showToast('Categorias salvas.');
          }}
        />
      )}
    </div>
  );
}
