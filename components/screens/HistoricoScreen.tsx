'use client';

import { useSearchParams } from 'next/navigation';
import { isModuleOn } from '@/lib/modules';
import { PageHeader } from '@/components/layout/PageHeader';
import { ModuleGate } from '@/components/modules/ModuleGate';
import { ModuleHelpButton } from '@/components/modules/ModuleHelpButton';
import { useHomeHref } from '@/components/modules/useHomeHref';
import { useModuleIntro } from '@/components/modules/useModuleIntro';
import { InvestmentHistory } from '@/components/history/InvestmentHistory';
import { SpendingHistory } from '@/components/history/SpendingHistory';
import { useSettings } from '@/components/providers/SettingsProvider';

export type HistoryTab = 'gastos' | 'investimentos';

const TABS: { key: HistoryTab; label: string }[] = [
  { key: 'gastos', label: 'Gastos' },
  { key: 'investimentos', label: 'Investimentos' },
];

export function HistoricoScreen() {
  return (
    <ModuleGate module="history">
      <Historico />
    </ModuleGate>
  );
}

/**
 * Histórico: the months of the budget ("Gastos") and, when the Diagrama is on, how the
 * investments went up and down ("Investimentos"). The tab lives in the address (`?aba=`), so the
 * module's tour can open either one.
 */
function Historico() {
  const backHref = useHomeHref();
  const { settings } = useSettings();
  const params = useSearchParams();
  const investing = !!settings && isModuleOn(settings, 'diagram');
  const tab: HistoryTab = investing && params.get('aba') === 'investimentos' ? 'investimentos' : 'gastos';
  useModuleIntro('history', { ready: true });

  const select = (key: HistoryTab) => {
    // Changes the address without a navigation (Next keeps useSearchParams in step).
    window.history.replaceState(null, '', `?aba=${key}`);
  };

  return (
    <div className="flex flex-1 flex-col gap-4 pb-10">
      <PageHeader title="Histórico" backHref={backHref} action={<ModuleHelpButton module="history" />} />

      {investing && (
        <div className="px-4">
          <div role="tablist" className="bg-card border-border grid grid-cols-2 gap-1 rounded-xl border p-1">
            {TABS.map((option) => (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={tab === option.key}
                onClick={() => select(option.key)}
                className={`min-h-[40px] rounded-lg text-sm font-semibold transition-colors ${
                  tab === option.key ? 'bg-primary text-primary-foreground' : 'text-muted hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'gastos' ? <SpendingHistory /> : <InvestmentHistory />}
    </div>
  );
}
