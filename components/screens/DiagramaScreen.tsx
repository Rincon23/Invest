'use client';

import { useEffect, useState } from 'react';
import type { BankOnlyHolding } from '@/lib/banks';
import type { DiagramAsset, QuestionType } from '@/lib/diagram';
import { diagramRepository } from '@/lib/storage';
import { PageHeader } from '@/components/layout/PageHeader';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useToast } from '@/components/ui/Toast';
import { ModuleGate } from '@/components/modules/ModuleGate';
import { ModuleHelpButton, ModuleSettingsButton } from '@/components/modules/ModuleHelpButton';
import { useHomeHref } from '@/components/modules/useHomeHref';
import { useModuleIntro } from '@/components/modules/useModuleIntro';
import { AddAssetSheet } from '@/components/diagram/AddAssetSheet';
import { AporteTab } from '@/components/diagram/AporteTab';
import { AssetSheet } from '@/components/diagram/AssetSheet';
import { AssetsTab } from '@/components/diagram/AssetsTab';
import { QuestionsSheet } from '@/components/diagram/QuestionsSheet';
import { TargetsSheet } from '@/components/diagram/TargetsSheet';
import { useBankHoldings } from '@/components/diagram/useBankHoldings';
import { useDiagram } from '@/components/diagram/useDiagram';

export type DiagramTab = 'aporte' | 'ativos';

const TABS: { key: DiagramTab; label: string }[] = [
  { key: 'aporte', label: 'Aporte' },
  { key: 'ativos', label: 'Ativos e notas' },
];

export function DiagramaScreen({
  initialTab,
  checkBanks,
}: {
  initialTab?: DiagramTab;
  checkBanks?: boolean;
}) {
  return (
    <ModuleGate module="diagram">
      <Diagrama initialTab={initialTab} checkBanks={checkBanks} />
    </ModuleGate>
  );
}

function Diagrama({ initialTab, checkBanks }: { initialTab?: DiagramTab; checkBanks?: boolean }) {
  const backHref = useHomeHref();
  const { settings } = useSettings();
  const { showToast } = useToast();
  const { overview, error, refresh } = useDiagram();
  const [tab, setTab] = useState<DiagramTab>(initialTab ?? 'aporte');
  const [configuring, setConfiguring] = useState(false);
  const [adding, setAdding] = useState(false);
  /** "Adicionar" from what the banks hold: the sheet starts filled in. */
  const [fromBank, setFromBank] = useState<BankOnlyHolding | null>(null);
  const holdings = useBankHoldings();
  const [openAsset, setOpenAsset] = useState<string | null>(null);
  const [questionsFor, setQuestionsFor] = useState<QuestionType | 'any' | null>(null);
  useModuleIntro('diagram', { ready: !!overview });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  if (!overview || !settings) {
    return (
      <div className="text-muted flex flex-1 items-center justify-center px-4 py-16">
        {error ?? 'Carregando…'}
      </div>
    );
  }

  const asset = openAsset ? overview.assets.find((item) => item.id === openAsset) : undefined;

  return (
    <div className="flex flex-1 flex-col gap-3 pb-10">
      <PageHeader
        title="Diagrama"
        backHref={backHref}
        action={
          <>
            <ModuleHelpButton module="diagram" />
            <ModuleSettingsButton module="diagram" onClick={() => setConfiguring(true)} tourAnchor="diagrama-config" />
          </>
        }
      />

      <div className="px-4" data-tour="diagrama-abas">
        <div role="tablist" className="bg-card border-border grid grid-cols-2 gap-1 rounded-xl border p-1">
          {TABS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={tab === option.key}
              onClick={() => setTab(option.key)}
              className={`min-h-[40px] rounded-lg text-sm font-semibold transition-colors ${
                tab === option.key ? 'bg-primary text-primary-foreground' : 'text-muted hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="bg-danger-bg text-danger mx-4 rounded-lg px-3 py-2 text-sm">{error}</p>}

      {tab === 'aporte' ? (
        <AporteTab
          overview={overview}
          settings={settings}
          onChanged={refresh}
          onOpenTargets={() => setConfiguring(true)}
        />
      ) : (
        <AssetsTab
          overview={overview}
          holdings={holdings}
          checkBanks={checkBanks}
          onOpenAsset={(item: DiagramAsset) => setOpenAsset(item.id)}
          onAddAsset={() => {
            setFromBank(null);
            setAdding(true);
          }}
          onAddFromBank={(item) => {
            setFromBank(item);
            setAdding(true);
          }}
          onOpenQuestions={() => setQuestionsFor('any')}
          onOpenTargets={() => setConfiguring(true)}
          onChanged={refresh}
        />
      )}

      {configuring && (
        <TargetsSheet
          overview={overview}
          onClose={() => setConfiguring(false)}
          onSave={async (targets) => {
            try {
              await diagramRepository.saveTargets(targets);
              await refresh();
              setConfiguring(false);
              showToast('Metas salvas.');
            } catch (err) {
              showToast(err instanceof Error ? err.message : 'Não foi possível salvar as metas.', 'error');
            }
          }}
        />
      )}

      {adding && (
        <AddAssetSheet
          overview={overview}
          fromBank={fromBank ?? undefined}
          onClose={() => setAdding(false)}
          onAdded={async (added) => {
            await refresh();
            setAdding(false);
            setOpenAsset(added.id);
            showToast(`${added.ticker} adicionado. Agora dê a nota dele.`);
          }}
        />
      )}

      {asset && (
        <AssetSheet
          key={asset.id}
          overview={overview}
          asset={asset}
          onClose={() => setOpenAsset(null)}
          onChanged={async () => {
            await refresh();
          }}
          onOpenQuestions={(type) => setQuestionsFor(type)}
        />
      )}

      {questionsFor && (
        <QuestionsSheet
          overview={overview}
          initialType={questionsFor === 'any' ? undefined : questionsFor}
          onClose={() => setQuestionsFor(null)}
          onChanged={async () => {
            await refresh();
          }}
        />
      )}
    </div>
  );
}
