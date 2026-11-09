'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, CircleHelp } from 'lucide-react';
import { formatBRL, parseAmountInput, todayISO } from '@/lib/budget';
import {
  activeQuestions,
  assetScore,
  assetType,
  countedQuestions,
  formatScore,
  grahamAnswer,
  isFixedIncomeType,
  RECOMMENDED_QUESTIONS,
  SCORE_SCALE,
  type Answer,
  type AssetAnswers,
  type AssetIndicators,
  type DiagramAsset,
  type DiagramOverview,
  type DiagramQuestion,
  type QuestionType,
} from '@/lib/diagram';
import { diagramRepository } from '@/lib/storage';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useConfirm } from '@/components/ui/ConfirmSheet';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { formatDate, formatWhen, pct, quotasLabel } from './format';

/** A quantity as the field shows it: no thousands dots, comma for decimals ("1234,5"). */
export function quantityText(quantity: number): string {
  return quantity === 0 ? '' : String(quantity).replace('.', ',');
}

const FIELD =
  'border-border bg-background text-foreground focus:ring-primary w-full rounded-lg border px-3 py-2 text-base outline-none focus:ring-2';

/** An optional text: empty is "Não informado", and "Não informar" clears it. */
export function OptionalText({
  label,
  value,
  onChange,
  multiline,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  maxLength: number;
}) {
  return (
    <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
      <span className="flex items-center justify-between gap-2">
        {label}
        {value.trim() !== '' && (
          <button type="button" onClick={() => onChange('')} className="text-primary text-xs font-semibold">
            Não informar
          </button>
        )}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Não informado"
          maxLength={maxLength}
          rows={2}
          className={FIELD}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Não informado"
          maxLength={maxLength}
          className={`${FIELD} min-h-[44px]`}
        />
      )}
    </label>
  );
}

/** The direct score, −10 … 10 on screen (kept from −1 to 1), with a slider and the number. */
export function DirectScoreField({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-muted text-sm font-medium">Nota</span>
        <span className="text-foreground text-sm font-semibold tabular-nums">{formatScore(value)}</span>
      </div>
      <input
        type="range"
        min={-SCORE_SCALE}
        max={SCORE_SCALE}
        step={0.5}
        value={(value ?? 0) * SCORE_SCALE}
        onChange={(event) => onChange(Number(event.target.value) / SCORE_SCALE)}
        aria-label="Nota do ativo"
        className="accent-primary w-full"
      />
      <span className="text-muted flex justify-between text-[11px]">
        <span>−10</span>
        <span>0</span>
        <span>10</span>
      </span>
    </div>
  );
}

const ANSWERS: { value: Answer | null; label: string; aria: string }[] = [
  { value: 1, label: 'Sim', aria: 'Sim' },
  { value: -1, label: 'Não', aria: 'Não' },
  { value: null, label: '—', aria: 'Sem resposta' },
];

/** The numbers behind an automatic answer, in one short line. */
function autoDetail(
  question: DiagramQuestion,
  indicators: AssetIndicators | undefined,
  price: number | null,
) {
  if (!indicators) return 'Esperando os dados do Fundamentus.';
  if (question.auto === 'pvp') {
    return indicators.pvp === null
      ? 'Sem P/VP no Fundamentus.'
      : `P/VP ${indicators.pvp.toLocaleString('pt-BR')}`;
  }
  const graham = grahamAnswer(price, indicators.lpa, indicators.vpa);
  if (!graham) return 'Sem preço ou sem LPA/VPA.';
  if (graham.verdict === 'negative') return 'Lucro ou patrimônio negativo.';
  const above = (graham.ratio ?? 1) - 1;
  const verdict =
    graham.verdict === 'fair' ? '' : graham.verdict === 'expensive' ? ' · caro' : ' · Graham não se aplica';
  return `Justo ${formatBRL(graham.fairValue ?? 0)} · preço ${above >= 0 ? '+' : '−'}${pct(Math.abs(above))} · P/L ${(
    graham.pl ?? 0
  ).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${verdict}`;
}

/** One question, its Sim / Não / — buttons and, behind "?", its help. */
function QuestionRow({
  question,
  answer,
  onAnswer,
}: {
  question: DiagramQuestion;
  answer: Answer | null;
  onAnswer: (value: Answer | null) => void;
}) {
  const [help, setHelp] = useState(false);
  const off = question.weight <= 0;
  return (
    <li className={`flex flex-col gap-1.5 ${off ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-1">
        <p className="text-foreground min-w-0 flex-1 text-sm">
          <span className="text-muted mr-1.5 text-[11px] font-semibold uppercase">{question.criterion}</span>
          {question.text}
          {off ? (
            <span className="text-muted"> (desligada)</span>
          ) : question.weight !== 1 ? (
            <span className="text-muted"> (peso {question.weight.toLocaleString('pt-BR')})</span>
          ) : null}
        </p>
        {question.help && (
          <button
            type="button"
            onClick={() => setHelp((open) => !open)}
            aria-expanded={help}
            aria-label={`Ajuda: ${question.criterion}`}
            className="text-muted hover:text-foreground -mt-1 flex h-8 w-8 shrink-0 items-center justify-center"
          >
            <CircleHelp aria-hidden className="h-4 w-4" />
          </button>
        )}
      </div>
      {help && question.help && <p className="text-muted -mt-0.5 text-xs">{question.help}</p>}
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={question.text}>
        {ANSWERS.map((option) => {
          const selected = answer === option.value;
          return (
            <button
              key={option.aria}
              type="button"
              disabled={off}
              aria-pressed={selected}
              aria-label={`${option.aria}: ${question.criterion}`}
              onClick={() => onAnswer(option.value)}
              className={`min-h-[38px] rounded-lg border text-sm font-medium transition-colors ${
                selected
                  ? option.value === 1
                    ? 'border-success bg-success-bg text-success'
                    : option.value === -1
                      ? 'border-danger bg-danger-bg text-danger'
                      : 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </li>
  );
}

/** A question the app answers by itself (restricted): the answer and the numbers it came from. */
function AutoQuestionRow({
  question,
  answer,
  indicators,
  price,
}: {
  question: DiagramQuestion;
  answer: Answer | null;
  indicators: AssetIndicators | undefined;
  price: number | null;
}) {
  return (
    <li className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm">
          <span className="text-muted mr-1.5 text-[11px] font-semibold uppercase">{question.criterion}</span>
          {question.text}
        </p>
        <p className="text-muted text-xs">
          {autoDetail(question, indicators, price)}
          {indicators ? ` · ${formatWhen(indicators.fetchedAt)}` : ''}
        </p>
      </div>
      <span
        className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
          answer === 1
            ? 'border-success bg-success-bg text-success'
            : answer === -1
              ? 'border-danger bg-danger-bg text-danger'
              : 'border-border text-muted'
        }`}
      >
        {answer === 1 ? 'Sim' : answer === -1 ? 'Não' : '—'}
      </span>
    </li>
  );
}

/**
 * One asset: the score on top (changing as the person answers), "Não compro mais", the questions
 * of its type — or, for an ETF, a fixed-income fund or a type with no questions yet, a score typed
 * directly — the quantity, and the optional details folded away.
 */
export function AssetSheet({
  overview,
  asset,
  onClose,
  onChanged,
  onOpenQuestions,
}: {
  overview: DiagramOverview;
  asset: DiagramAsset;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
  onOpenQuestions: (type: QuestionType) => void;
}) {
  const confirm = useConfirm();
  const { showToast } = useToast();
  const type = assetType(asset.type);
  const fixedIncome = isFixedIncomeType(asset.type);
  // The automatic questions (Graham, P/VP) are restricted: without access they never show up.
  const questions = fixedIncome ? [] : countedQuestions(overview, asset.type);
  const savedAnswers = useMemo(() => overview.answers[asset.id] ?? {}, [overview.answers, asset.id]);
  const quote = overview.quotes[asset.id];

  const [quantity, setQuantity] = useState(quantityText(asset.quantity));
  const [stopBuying, setStopBuying] = useState(asset.stopBuying);
  const [isEtf, setIsEtf] = useState(asset.isEtf);
  const [directScore, setDirectScore] = useState<number | null>(asset.directScore);
  const [answers, setAnswers] = useState<AssetAnswers>(savedAnswers);
  const [sector, setSector] = useState(asset.sector ?? '');
  const [subsector, setSubsector] = useState(asset.subsector ?? '');
  const [note, setNote] = useState(asset.note ?? '');
  // The optional details stay folded unless the asset already has some.
  const [details, setDetails] = useState(!!(asset.sector || asset.subsector || asset.note));
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);

  const parsedQuantity = Math.max(0, parseAmountInput(quantity));
  const score = assetScore({ isEtf: isEtf || fixedIncome, directScore }, questions, answers);
  const noQuestions = activeQuestions(questions).length === 0;
  const direct = fixedIncome || isEtf || noQuestions;
  const recommended = !fixedIncome && RECOMMENDED_QUESTIONS[asset.type as QuestionType].length > 0;

  function answer(questionId: string, value: Answer | null) {
    setAnswers((current) => {
      const next = { ...current };
      if (value === null) delete next[questionId];
      else next[questionId] = value;
      return next;
    });
  }

  async function handleRecommended() {
    setCopying(true);
    try {
      const { added } = await diagramRepository.useRecommended(asset.type as QuestionType);
      await onChanged();
      showToast(
        added > 0
          ? `${added} perguntas recomendadas entraram em ${type.label}.`
          : 'As recomendadas já estão lá.',
      );
    } catch {
      showToast('Não foi possível copiar as perguntas.', 'error');
    } finally {
      setCopying(false);
    }
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Remover ${asset.ticker}?`,
      message: `${asset.ticker} sai do Diagrama com as respostas dele; os aportes registrados continuam.`,
      confirmLabel: 'Remover',
      cancelLabel: 'Manter',
      destructive: true,
    });
    if (!ok) return;
    try {
      await diagramRepository.deleteAsset(asset.id);
      await onChanged();
      showToast(`${asset.ticker} removido.`);
      onClose();
    } catch {
      showToast('Não foi possível remover. Tente de novo em instantes.', 'error');
    }
  }

  const status = stopBuying
    ? 'Não compro mais: nunca recebe aporte.'
    : score.score === null
      ? 'Sem nota: não recebe aporte.'
      : score.score <= 0
        ? 'Nota 0 ou menor: não recebe aporte.'
        : null;

  return (
    <BottomSheet open title={asset.ticker} onClose={onClose}>
      <form
        className="flex flex-col gap-5"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          try {
            await diagramRepository.updateAsset(
              asset.id,
              {
                type: asset.type,
                ticker: asset.ticker,
                quantity: parsedQuantity,
                sector,
                subsector,
                note,
                stopBuying,
                isEtf,
                directScore,
              },
              todayISO(),
            );
            const changed = questions.filter(
              (question) =>
                !question.auto && (answers[question.id] ?? null) !== (savedAnswers[question.id] ?? null),
            );
            for (const question of changed) {
              await diagramRepository.setAnswer(asset.id, question.id, answers[question.id] ?? null);
            }
            await onChanged();
            showToast('Ativo salvo.');
            onClose();
          } catch (err) {
            showToast(err instanceof Error ? err.message : 'Não foi possível salvar.', 'error');
          } finally {
            setSaving(false);
          }
        }}
      >
        <section className="bg-background flex items-center gap-4 rounded-xl p-3" aria-live="polite">
          <div className="flex flex-col items-center">
            <span className="text-muted text-[11px]">Nota</span>
            <span className="text-foreground text-2xl leading-tight font-semibold tabular-nums">
              {formatScore(score.score)}
            </span>
          </div>
          <div className="min-w-0 flex-1 text-xs">
            <p className="text-muted truncate">
              {type.label}
              {quote?.name ? ` · ${quote.name}` : ''}
            </p>
            <p className="text-foreground">
              {quote ? `${formatBRL(quote.price)} por cota` : 'Sem cotação ainda'}
              {quote && asset.quantity > 0
                ? ` · ${quotasLabel(asset.quantity, asset.type)} = ${formatBRL(asset.quantity * quote.price)}`
                : ''}
            </p>
            {score.source === 'questions' && (
              <p className="text-muted">
                <span className="text-success">+{score.positive.toLocaleString('pt-BR')}</span>{' '}
                <span className="text-danger">−{score.negative.toLocaleString('pt-BR')}</span>
                {score.unanswered > 0 ? ` · ${score.unanswered} sem resposta` : ''}
              </p>
            )}
            {status && <p className="text-warning">{status}</p>}
          </div>
        </section>

        <div className="flex flex-col gap-3">
          <label className="flex min-h-[32px] items-center justify-between gap-3">
            <span className="text-foreground text-sm font-medium">Não compro mais</span>
            <input
              type="checkbox"
              checked={stopBuying}
              onChange={(event) => setStopBuying(event.target.checked)}
              className="accent-primary h-5 w-5 shrink-0"
            />
          </label>
          {!fixedIncome && (
            <div className="flex min-h-[32px] items-center justify-between gap-3">
              <span className="text-foreground text-sm font-medium">É um ETF (nota direta)</span>
              <Switch checked={isEtf} onChange={setIsEtf} label="É um ETF" />
            </div>
          )}
        </div>

        {direct && (
          <DirectScoreField
            value={directScore}
            onChange={(value) => setDirectScore(Math.round(value * 100) / 100)}
          />
        )}

        {!fixedIncome && !isEtf && noQuestions && (
          <div className="border-border flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-3">
            <p className="text-muted w-full text-xs">
              {type.label} ainda não tem perguntas: use a nota acima.
            </p>
            <button
              type="button"
              onClick={() => onOpenQuestions(asset.type as QuestionType)}
              className="border-border text-foreground min-h-[38px] rounded-lg border px-3 text-sm font-medium"
            >
              Criar perguntas
            </button>
            {recommended && (
              <button
                type="button"
                onClick={() => void handleRecommended()}
                disabled={copying}
                className="bg-primary text-primary-foreground min-h-[38px] rounded-lg px-3 text-sm font-semibold disabled:opacity-50"
              >
                {copying ? 'Copiando…' : 'Usar as recomendadas'}
              </button>
            )}
          </div>
        )}

        {!direct && (
          <ul className="flex flex-col gap-4">
            {questions.map((question) =>
              question.auto ? (
                <AutoQuestionRow
                  key={question.id}
                  question={question}
                  answer={answers[question.id] ?? null}
                  indicators={overview.indicators[asset.id]}
                  price={quote?.price ?? null}
                />
              ) : (
                <QuestionRow
                  key={question.id}
                  question={question}
                  answer={answers[question.id] ?? null}
                  onAnswer={(value) => answer(question.id, value)}
                />
              ),
            )}
          </ul>
        )}

        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Quantidade de cotas
          <input
            type="text"
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder="0"
            className={`${FIELD} min-h-[44px]`}
          />
          <span className="text-muted text-xs font-normal">
            Atualizada em {formatDate(asset.quantityUpdatedOn)}
          </span>
        </label>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setDetails((open) => !open)}
            aria-expanded={details}
            className="text-muted flex items-center gap-1 self-start text-sm font-medium"
          >
            <ChevronDown
              aria-hidden
              className={`h-4 w-4 transition-transform ${details ? 'rotate-180' : ''}`}
            />
            Setor e observação
          </button>
          {details && (
            <>
              <OptionalText label="Setor" value={sector} onChange={setSector} maxLength={100} />
              <OptionalText label="Subsetor" value={subsector} onChange={setSubsector} maxLength={100} />
              <OptionalText label="Observação" value={note} onChange={setNote} multiline maxLength={500} />
            </>
          )}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        <button
          type="button"
          onClick={() => void handleDelete()}
          className="text-danger min-h-[40px] text-sm font-semibold"
        >
          Remover ativo
        </button>
      </form>
    </BottomSheet>
  );
}
