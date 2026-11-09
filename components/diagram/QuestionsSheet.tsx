'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import {
  AUTO_QUESTIONS,
  assetType,
  countedQuestions,
  isFixedIncomeType,
  RECOMMENDED_QUESTIONS,
  QUESTION_TYPES,
  typesInUse,
  type DiagramOverview,
  type AutoQuestionKind,
  type DiagramQuestion,
  type QuestionType,
} from '@/lib/diagram';
import { diagramRepository } from '@/lib/storage';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useConfirm } from '@/components/ui/ConfirmSheet';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { TypeChips } from './TypeChips';

/**
 * Each type's own list of questions (changing one type never touches another): create, rename,
 * reorder and remove, each with a short criterion, the question, an optional help and a weight.
 * "Usar as recomendadas" copies the app's list into that type only.
 */
export function QuestionsSheet({
  overview,
  initialType,
  onClose,
  onChanged,
}: {
  overview: DiagramOverview;
  initialType?: QuestionType;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const inUse = typesInUse(overview.settings.targets).filter(
    (key): key is QuestionType => !isFixedIncomeType(key),
  );
  // The types of the portfolio; with none yet, every type that has questions.
  const types = inUse.length > 0 ? inUse : QUESTION_TYPES;
  const [type, setType] = useState<QuestionType>(
    initialType && types.includes(initialType) ? initialType : types[0],
  );
  const [editing, setEditing] = useState<DiagramQuestion | 'new' | null>(null);
  const [busy, setBusy] = useState(false);

  // The automatic questions (Graham, P/VP) are restricted: without access they never show up.
  const questions = countedQuestions(overview, type);
  const recommended = RECOMMENDED_QUESTIONS[type];
  // The automatic question this type can have, and whether it is already on.
  const automatic = overview.vip ? AUTO_QUESTIONS.find((definition) => definition.type === type) : undefined;
  const automaticOn = automatic ? questions.some((question) => question.auto === automatic.kind) : false;
  const label = assetType(type).label;

  async function act(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await action();
      await onChanged();
      if (done) showToast(done);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Não foi possível salvar.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, delta: -1 | 1) {
    const ids = questions.map((question) => question.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void act(() => diagramRepository.reorderQuestions(type, ids));
  }

  async function handleDelete(question: DiagramQuestion) {
    const answered = Object.values(overview.answers).filter(
      (answers) => answers[question.id] !== undefined,
    ).length;
    const ok = await confirm({
      title: 'Remover pergunta?',
      message:
        answered > 0
          ? `"${question.criterion}" sai de ${label}, com as respostas. Para só desligar, use peso 0.`
          : `"${question.criterion}" sai de ${label}. Para só desligar, use peso 0.`,
      confirmLabel: 'Remover',
      cancelLabel: 'Manter',
      destructive: true,
    });
    if (!ok) return;
    setEditing(null);
    await act(() => diagramRepository.deleteQuestion(question.id), 'Pergunta removida.');
  }

  return (
    <BottomSheet open title="Perguntas" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <TypeChips types={types} selected={type} onSelect={setType} />

        {questions.length === 0 ? (
          <div className="border-border flex flex-col gap-2 rounded-xl border border-dashed p-4">
            <p className="text-foreground text-sm">{label} ainda não tem perguntas.</p>
            <p className="text-muted text-xs">
              {recommended.length > 0
                ? `Crie as suas ou use as ${recommended.length} recomendadas.`
                : 'Crie as suas ou dê a nota direto no ativo.'}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {questions.map((question, index) => (
              <li
                key={question.id}
                className={`border-border bg-background flex items-center gap-2 rounded-xl border px-3 py-2 ${
                  question.weight <= 0 ? 'opacity-60' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => setEditing(question)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="text-muted flex flex-wrap items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase">
                    {question.criterion}
                    {question.auto && (
                      <span className="bg-primary/10 text-primary rounded-full px-1.5 py-0.5 text-[10px] tracking-normal normal-case">
                        Automática
                      </span>
                    )}
                    {question.weight <= 0
                      ? ' · desligada'
                      : question.weight !== 1
                        ? ` · peso ${question.weight.toLocaleString('pt-BR')}`
                        : ''}
                  </span>
                  <span className="text-foreground block text-sm">{question.text}</span>
                </button>
                <div className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={busy || index === 0}
                    aria-label={`Subir "${question.criterion}"`}
                    className="text-muted hover:text-foreground flex h-8 w-8 items-center justify-center disabled:opacity-30"
                  >
                    <ArrowUp aria-hidden className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={busy || index === questions.length - 1}
                    aria-label={`Descer "${question.criterion}"`}
                    className="text-muted hover:text-foreground flex h-8 w-8 items-center justify-center disabled:opacity-30"
                  >
                    <ArrowDown aria-hidden className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {automatic && !automaticOn && (
          <div className="border-border flex flex-col gap-2 rounded-xl border p-3">
            <p className="text-foreground text-sm font-semibold">
              Pergunta automática: {automatic.criterion}
            </p>
            <p className="text-muted text-xs">
              {automatic.kind === 'graham'
                ? 'Responde sozinha, todo dia, pelo preço justo de Graham.'
                : 'Responde sozinha, todo dia: P/VP abaixo de 1 é Sim.'}
              {questions.some(
                (question) => question.criterion.trim().toLowerCase() === automatic.criterion.toLowerCase(),
              )
                ? ` A sua pergunta "${automatic.criterion}" passa a ser respondida sozinha.`
                : ''}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(
                  () => diagramRepository.enableAutoQuestion(automatic.kind),
                  `${automatic.criterion} automático ligado.`,
                )
              }
              className="bg-primary text-primary-foreground min-h-[40px] self-start rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
            >
              Ligar
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="border-border text-foreground flex min-h-[44px] items-center gap-1.5 rounded-lg border px-4 text-sm font-medium"
          >
            <Plus aria-hidden className="h-4 w-4" />
            Nova pergunta
          </button>
          {recommended.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const { added } = await diagramRepository.useRecommended(type);
                  showToast(
                    added > 0
                      ? `${added} perguntas recomendadas entraram em ${label}.`
                      : 'As recomendadas já estão todas aqui.',
                  );
                })
              }
              className={`flex min-h-[44px] items-center rounded-lg px-4 text-sm font-semibold disabled:opacity-50 ${
                questions.length === 0
                  ? 'bg-primary text-primary-foreground'
                  : 'border-border text-foreground border'
              }`}
            >
              {questions.length === 0 ? 'Usar as recomendadas' : 'Adicionar as recomendadas que faltam'}
            </button>
          )}
        </div>
        <p className="text-muted text-xs">
          Sim +1, Não −1, sem resposta 0, vezes o peso; a nota vai de −10 a 10.
        </p>
      </div>

      {editing && (
        <QuestionFormSheet
          initial={editing === 'new' ? undefined : editing}
          typeLabel={label}
          onClose={() => setEditing(null)}
          onDelete={editing === 'new' ? undefined : () => void handleDelete(editing)}
          onSave={async (values) => {
            await act(
              () =>
                editing === 'new'
                  ? diagramRepository.addQuestion({ type, ...values })
                  : diagramRepository.updateQuestion(editing.id, values),
              editing === 'new' ? 'Pergunta criada.' : 'Pergunta salva.',
            );
            setEditing(null);
          }}
        />
      )}
    </BottomSheet>
  );
}

function QuestionFormSheet({
  initial,
  typeLabel,
  onClose,
  onSave,
  onDelete,
}: {
  initial?: DiagramQuestion;
  typeLabel: string;
  onClose: () => void;
  onSave: (values: {
    criterion: string;
    text: string;
    help: string | null;
    weight: number;
    auto?: AutoQuestionKind | null;
  }) => Promise<void>;
  onDelete?: () => void;
}) {
  const [automatic, setAutomatic] = useState(!!initial?.auto);
  const [criterion, setCriterion] = useState(initial?.criterion ?? '');
  const [text, setText] = useState(initial?.text ?? '');
  const [help, setHelp] = useState(initial?.help ?? '');
  const [weight, setWeight] = useState(initial?.weight ?? 1);
  const [saving, setSaving] = useState(false);
  const field =
    'border-border bg-background text-foreground focus:ring-primary w-full rounded-lg border px-3 py-2 text-base outline-none focus:ring-2';

  return (
    <BottomSheet open title={initial ? 'Editar pergunta' : `Nova pergunta · ${typeLabel}`} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!criterion.trim() || !text.trim()) return;
          setSaving(true);
          try {
            await onSave({
              criterion: criterion.trim(),
              text: text.trim(),
              help: help.trim() || null,
              weight,
              // Turning the switch off makes it a normal question, answered by hand.
              ...(initial?.auto && !automatic ? { auto: null } : {}),
            });
          } finally {
            setSaving(false);
          }
        }}
      >
        {initial?.auto && (
          <div className="flex items-center justify-between gap-3">
            <span className="flex flex-col">
              <span className="text-foreground text-sm font-medium">Responder sozinha</span>
              <span className="text-muted text-xs">
                Desligada, vira uma pergunta respondida à mão.
              </span>
            </span>
            <Switch checked={automatic} onChange={setAutomatic} label="Responder sozinha" />
          </div>
        )}
        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Critério (curto)
          <input
            type="text"
            value={criterion}
            onChange={(event) => setCriterion(event.target.value)}
            maxLength={40}
            autoFocus={!initial}
            placeholder="Ex.: ROE, P/VP, Dívida"
            className={`${field} min-h-[44px]`}
          />
        </label>
        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Pergunta
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={300}
            rows={2}
            placeholder="Ex.: O ROE é maior que 10%?"
            className={field}
          />
          <span className="text-muted text-xs font-normal">
            Escreva de um jeito que &quot;Sim&quot; seja o bom.
          </span>
        </label>
        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Ajuda (opcional)
          <textarea
            value={help}
            onChange={(event) => setHelp(event.target.value)}
            maxLength={600}
            rows={2}
            placeholder="Não informada"
            className={field}
          />
        </label>
        <div className="flex items-center justify-between gap-3">
          <span className="flex flex-col">
            <span className="text-foreground text-sm font-medium">Peso</span>
            <span className="text-muted text-xs">1 é o normal; 2 vale o dobro; 0 desliga.</span>
          </span>
          <WeightInput value={weight} onChange={setWeight} />
        </div>
        <button
          type="submit"
          disabled={saving || !criterion.trim() || !text.trim()}
          className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        {onDelete && (
          <button type="button" onClick={onDelete} className="text-danger min-h-[40px] text-sm font-semibold">
            Remover pergunta
          </button>
        )}
      </form>
    </BottomSheet>
  );
}

/** The weight, 0 to 100: typed, or one step at a time with − and +. */
function WeightInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const set = (next: number) => onChange(Math.min(100, Math.max(0, Math.round(next * 10) / 10)));
  const button =
    'border-border text-foreground flex h-10 w-10 items-center justify-center rounded-lg border text-lg';
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button type="button" onClick={() => set(value - 1)} aria-label="Diminuir o peso" className={button}>
        −
      </button>
      <input
        type="number"
        min={0}
        max={100}
        step={0.5}
        value={value}
        onChange={(event) => set(Number(event.target.value))}
        aria-label="Peso da pergunta"
        className="border-border bg-background text-foreground min-h-[40px] w-14 rounded-lg border px-2 text-center outline-none"
      />
      <button type="button" onClick={() => set(value + 1)} aria-label="Aumentar o peso" className={button}>
        +
      </button>
    </div>
  );
}
