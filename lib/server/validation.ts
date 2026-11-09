import { z } from 'zod';
import { TAG_LIMITS, type HomeWidgetKey, type ModuleKey, type NavKey, type QuickCategoryKey } from '@/lib/budget';
import {
  HOME_WIDGET_KEYS,
  MAX_HOME_PAGES,
  MAX_WIDGETS_PER_HOME_PAGE,
  MERGED_RESERVE_MODULE,
  MODULE_KEYS,
  renameReserveKey,
  withoutRetiredModules,
} from '@/lib/modules';
import {
  ASSET_TYPE_KEYS,
  QUESTION_TYPES,
  type AssetType,
  type DiagramBackup,
  type DiagramTargets,
  type QuestionType,
} from '@/lib/diagram';
import { FACT_LIMITS } from '@/lib/motivation';
import { isAllowedPushEndpoint, type NotificationCategory } from '@/lib/notifications';
import { QUOTAS } from './quotas';

const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  'reminder',
  'card',
  'recurring',
  'gmail',
  'banks',
  'feature',
  'motivation',
  'system',
];

/** A partial map keyed by every module (or notification category): every key optional, like
 * `Partial<Record<K, V>>` — unlike `z.record` with an enum key, which demands every key present. */
function partialMap<K extends string, V extends z.ZodType>(keys: K[], value: V) {
  return z.object(
    Object.fromEntries(keys.map((key) => [key, value.optional()])) as Record<K, z.ZodOptional<V>>,
  );
}

/**
 * Validates everything the API receives. Unknown keys are dropped. Every list and every text has
 * a ceiling: far above real use, low enough that nobody can fill the server's disk (or its memory)
 * with one request. The counts per account are capped too, in the repositories (lib/server/quotas.ts).
 */

const MAX_TOPICS = QUOTAS.topics;

/** A real month ("2024-01" to "2024-12"), between 1970 and 2100. */
export const monthKeySchema = z.string().regex(/^(19[7-9]\d|20\d\d|2100)-(0[1-9]|1[0-2])$/, 'Mês inválido.');

/** A real calendar day ("2024-02-30" is refused). */
export const isoDate = z.iso.date('Data inválida.');
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido.');
/** Older data may carry null or '' where a field is simply absent. */
const absentAsUndefined = (value: unknown) => (value === null || value === '' ? undefined : value);

const topicSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().max(60),
  targetPct: z.number().min(-1000).max(1000),
  order: z.number().min(-10_000).max(10_000),
  archived: z.boolean().optional(),
  color: z.string().max(20).optional(),
  description: z.string().max(300, 'A descrição da categoria pode ter até 300 caracteres.').optional(),
  preset: z.enum(['diversos', 'investimentos', 'metas', 'conhecimentos']).optional(),
});

/**
 * Every module, as booleans (the routes replace them with what the account has, see
 * `withAccessRules`). An older backup or a cached client may still send the invested reserve
 * (`investments`), now part of Reserva.
 */
const modulesSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object' || !(MERGED_RESERVE_MODULE in value)) return value;
    const { [MERGED_RESERVE_MODULE]: invested, ...rest } = value as Record<string, unknown>;
    return invested === true ? { ...rest, cash: true } : rest;
  },
  z.object(
    Object.fromEntries(MODULE_KEYS.map((key) => [key, z.boolean().optional()])) as Record<
      ModuleKey,
      z.ZodOptional<z.ZodBoolean>
    >,
  ),
);

/** A key saved before the two reserves merged becomes the Reserva's (`renameReserveKey`). */
const renamedKey = (value: unknown) => (typeof value === 'string' ? renameReserveKey(value) : value);

/**
 * Obsolete: the bottom bar (Início or a module, at most four). Still accepted, so older backups and
 * cached clients keep working, and ignored.
 */
const navSchema = z.preprocess(
  withoutRetiredModules,
  z.array(z.preprocess(renamedKey, z.enum(['inicio', ...MODULE_KEYS] as [NavKey, ...NavKey[]]))).max(4),
);

/** Widgets that are gone, and what took their place: "Primeiros passos" became Missões (now not a widget either). */
const RETIRED_WIDGETS: Record<string, HomeWidgetKey> = { firstSteps: 'missions' };

/** A widget of the Início: a module's card or one of the extra widgets (lib/modules/home.ts). */
const homeWidgetSchema = z.preprocess(
  (value) => {
    const key = renamedKey(value);
    return typeof key === 'string' && Object.hasOwn(RETIRED_WIDGETS, key) ? RETIRED_WIDGETS[key] : key;
  },
  z.enum(HOME_WIDGET_KEYS as [HomeWidgetKey, ...HomeWidgetKey[]]),
);

/** Widgets in a list, without the ones of a retired module (`withoutRetiredModules`). */
const homeWidgetList = (max: number) => z.preprocess(withoutRetiredModules, z.array(homeWidgetSchema).max(max));

/** A category as the expense form lists it: "topic:<id>" or a special kind. */
const quickCategorySchema = z.union([
  z.enum(['fixedCost', 'unforeseen', 'reimbursable', 'uncounted']),
  z.templateLiteral(['topic:', z.string().min(1).max(100)]),
]) as z.ZodType<QuickCategoryKey>;

const label = z.string().max(60);
const color = z.string().max(20);

/** A tag of expenses or incomes (`Tag`): it changes no number, it only labels entries. */
export const tagSchema = z.object({
  id: z.string().min(1).max(100),
  name: z
    .string()
    .trim()
    .min(1, 'Dê um nome para a tag.')
    .max(TAG_LIMITS.name, `O nome da tag pode ter até ${TAG_LIMITS.name} letras.`),
  kind: z.enum(['expense', 'income']),
  color: z.preprocess(absentAsUndefined, color.optional()),
  order: z.number().int().min(0).max(100_000),
});

/** The tags on an entry, a template or a plan: which ones exist is checked by the repository. */
const tagIdsSchema = z.array(z.string().min(1).max(100)).max(TAG_LIMITS.perEntry, `Dá para pôr até ${TAG_LIMITS.perEntry} tags.`);

/** Body of "pôr ou tirar tags" of an entry, allowed in a closed month too. */
export const entryTagsSchema = z.object({ tagIds: tagIdsSchema });

export const settingsSchema = z.object({
  topics: z
    .array(topicSchema)
    .max(MAX_TOPICS, `Dá para ter até ${MAX_TOPICS} categorias, contando as arquivadas.`),
  specialCategories: z.object({
    fixedCost: label,
    unforeseen: label,
    // Older data (and backups from before the module existed) has no "A receber" label.
    reimbursable: label.optional(),
    // Likewise for "Fora do orçamento", which came later.
    uncounted: label.optional(),
  }),
  specialCategoryColors: z
    .object({
      fixedCost: color,
      unforeseen: color,
      reimbursable: color,
      uncounted: color,
    })
    .partial()
    .optional(),
  onboardingCompleted: z.boolean().optional(),
  modules: modulesSchema.optional(),
  nav: navSchema.nullable().optional(),
  dismissedNotices: z.array(z.string().min(1).max(60)).max(200).optional(),
  notificationPrefs: partialMap(NOTIFICATION_CATEGORIES, z.boolean()).optional(),
  homeOrder: homeWidgetList(50).nullable().optional(),
  homePages: z.array(homeWidgetList(MAX_WIDGETS_PER_HOME_PAGE)).max(MAX_HOME_PAGES).nullable().optional(),
  homeCardSizes: partialMap(HOME_WIDGET_KEYS, z.enum(['half', 'full'])).optional(),
  homeHidden: homeWidgetList(50).optional(),
  quickCategories: z
    .array(quickCategorySchema)
    .max(MAX_TOPICS + 4)
    .nullable()
    .optional(),
  // Read only from a backup: an ordinary save never changes the tags (see `saveTag`).
  tags: z
    .array(tagSchema)
    .max(TAG_LIMITS.perKind * 2)
    .optional(),
});

export const incomeSchema = z.object({
  id: z.string().min(1).max(100),
  source: z.string().max(500),
  amount: z.number(),
  date: z.preprocess(absentAsUndefined, isoDate.optional()),
  topicId: z.preprocess(absentAsUndefined, z.string().max(100).optional()),
  // Absent (an older client) keeps the tags the income already has.
  tagIds: tagIdsSchema.optional(),
});

const categoryKindSchema = z.enum(['topic', 'fixedCost', 'unforeseen', 'reimbursable', 'uncounted']);

export const expenseSchema = z.object({
  id: z.string().min(1).max(100),
  categoryKind: categoryKindSchema,
  topicId: z.preprocess(absentAsUndefined, z.string().max(100).optional()),
  description: z.string().max(500),
  amount: z.number(),
  date: isoDate,
  singleInstallmentCard: z.boolean().optional(),
  cardId: z.preprocess(absentAsUndefined, z.string().max(100).optional()),
  // `voice` and `text`: older expenses of the retired "Lançar por voz ou texto".
  source: z.enum(['form', 'voice', 'text', 'recurring', 'investment', 'installment', 'import']).optional(),
  // Echoed back by the client when it edits an instalment's expense, so the link survives.
  installmentId: z.preprocess(absentAsUndefined, z.string().max(100).optional()),
  // 0 is the single expense of an "à vista" plan (see lib/budget/bill.ts).
  installmentNumber: z.preprocess(absentAsUndefined, z.number().int().min(0).optional()),
  /** When an "A receber" purchase was paid back (ISO instant). */
  reimbursedAt: z.preprocess(absentAsUndefined, z.iso.datetime().optional()),
  /** The recurring template ("Contas do mês") it was launched from. */
  recurringId: z.preprocess(absentAsUndefined, z.string().max(100).optional()),
  // Absent (an older client) keeps the tags the expense already has.
  tagIds: tagIdsSchema.optional(),
});

export const monthDataSchema = z.object({
  month: monthKeySchema,
  incomes: z.array(incomeSchema).max(1000),
  expenses: z.array(expenseSchema).max(5000),
  carryIn: z
    .record(z.string().max(100), z.number())
    .refine((value) => Object.keys(value).length <= MAX_TOPICS, 'Dados inválidos.'),
  topicsSnapshot: z.array(topicSchema).max(MAX_TOPICS),
  closed: z.boolean().optional(),
  leftoversDropped: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Carteira
// ---------------------------------------------------------------------------

const money = z.number().finite();

export const recurringExpenseSchema = z.object({
  id: z.string().min(1).max(100),
  categoryKind: categoryKindSchema,
  topicId: z.preprocess(absentAsUndefined, z.string().max(100).optional()),
  description: z.string().min(1).max(500),
  amount: money.positive(),
  card: z.boolean(),
  cardId: z.preprocess(absentAsUndefined, z.string().max(100).optional()),
  /** A template launched as a parcelamento (see RecurringExpense). */
  installmentCount: z.preprocess(absentAsUndefined, z.number().int().min(2).max(120).optional()),
  installmentAccounting: z.preprocess(absentAsUndefined, z.enum(['installment', 'upfront']).optional()),
  /** The day of the month it falls due; absent when the person did not say. */
  dueDay: z.preprocess(absentAsUndefined, z.number().int().min(1).max(31).optional()),
  tagIds: tagIdsSchema.optional(),
});

export const installmentPlanSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  categoryKind: categoryKindSchema,
  topicId: z.preprocess(absentAsUndefined, z.string().max(100).optional()),
  firstDebitDate: isoDate,
  /** The day of the purchase itself; absent in older data (see InstallmentPlan). */
  purchaseDate: z.preprocess(absentAsUndefined, isoDate.optional()),
  count: z.number().int().min(1).max(120),
  totalAmount: money.positive(),
  accounting: z.enum(['installment', 'upfront']),
  cardId: z.preprocess(absentAsUndefined, z.string().max(100).optional()),
  /** Charges already paid before the purchase was registered here (see InstallmentPlan). */
  paidCount: z.preprocess(absentAsUndefined, z.number().int().min(0).max(120).optional()),
  /** Charges paid ahead of time ("adiantar parcelas"). */
  advancedCount: z.preprocess(absentAsUndefined, z.number().int().min(0).max(120).optional()),
  /** The recurring template it was launched from ("Contas do mês"). */
  recurringId: z.preprocess(absentAsUndefined, z.string().max(100).optional()),
  tagIds: tagIdsSchema.optional(),
});

export const creditCardSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1, 'Dê um nome ao cartão.').max(60),
  dueDay: z.number().int().min(1).max(31),
  dueMonth: z.enum(['same', 'next']),
  notifyEnabled: z.boolean(),
  notifyBeforeDays: z.number().int().min(0).max(30),
  isDefault: z.boolean(),
  /** Optional: a card with no limit simply shows nothing about one. */
  limit: z.preprocess(absentAsUndefined, money.positive().max(10_000_000).optional()),
  color: z.preprocess(absentAsUndefined, z.string().max(20).optional()),
  order: z.number().int().min(0).max(1000),
});

export const cardSettingsSchema = z.object({
  notifyTime: timeOfDay,
  repeatUntilPaid: z.boolean(),
});

export const recurringSettingsSchema = z.object({
  notifyEnabled: z.boolean(),
  notifyTime: timeOfDay,
  repeatUntilLaunched: z.boolean(),
});

export const investmentBucketSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  topicId: z.preprocess(absentAsUndefined, z.string().max(100).optional()),
  quotas: z.number().finite().min(0),
});

export const tickerSchema = z.object({ ticker: z.string().min(1).max(20) });

/** Buying is a positive delta, selling a negative one. */
export const tradeQuotasSchema = z.object({ delta: z.number().finite() });

export const allocateSchema = z.object({
  bucketId: z.string().min(1).max(100),
  amount: money.positive(),
  /** 'in' puts money into the bucket, 'out' takes it back out; absent in older clients. */
  direction: z.enum(['in', 'out']).optional(),
  month: monthKeySchema,
  date: isoDate,
});

/** Body of "adiantar parcelas": how many of the last charges were paid early, and the discount. */
export const advanceInstallmentSchema = z.object({
  count: z.number().int().min(1).max(120),
  discount: money.min(0),
  date: isoDate,
  month: monthKeySchema,
});

export const reservePlanSchema = z.object({
  targetAmount: money.positive(),
  months: z.number().int().min(1).max(120),
  startMonth: monthKeySchema,
  reason: z.preprocess(absentAsUndefined, z.string().trim().max(200).optional()),
});

/** Body of "lançar a parcela do plano": quanto e em que categoria. */
export const reserveContributionSchema = z.object({
  amount: money.positive(),
  month: monthKeySchema,
  date: isoDate,
  categoryKind: categoryKindSchema,
  topicId: z.preprocess(absentAsUndefined, z.string().max(100).optional()),
});

export const cashSettingsSchema = z.object({
  reserveAccountAmount: money.min(0),
  emergencyCosts: z.array(z.object({ label: z.string().max(200), amount: money.min(0) })).max(50),
  reserveMultiplier: z.number().int().min(1).max(60),
});

/**
 * A browser's `PushSubscription.toJSON()`. Only the real push services are accepted: the server
 * sends requests to this address, so anything else would make it a relay (lib/notifications/endpoints.ts).
 */
export const pushSubscriptionSchema = z.object({
  endpoint: z
    .url({ protocol: /^https$/ })
    .max(2000)
    .refine(isAllowedPushEndpoint, 'Serviço de notificação não reconhecido.'),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
  previousEndpoint: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// Lembretes
// ---------------------------------------------------------------------------

const reminderFields = {
  id: z.string().min(1).max(100),
  message: z.string().trim().min(1, 'Escreva o lembrete.').max(300),
  repeat: z.boolean(),
};

export const reminderInputSchema = z.discriminatedUnion('kind', [
  z.object({
    ...reminderFields,
    kind: z.literal('once'),
    date: isoDate,
    time: timeOfDay,
    notifyBeforeMinutes: z.union([z.literal(30), z.literal(60), z.literal(1440)]).nullable(),
  }),
  z.object({
    ...reminderFields,
    kind: z.literal('daily'),
    times: z.array(timeOfDay).min(1).max(12),
  }),
  z.object({
    ...reminderFields,
    kind: z.literal('weekly'),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    time: timeOfDay,
  }),
  z.object({
    ...reminderFields,
    kind: z.literal('monthly'),
    dayOfMonth: z.number().int().min(1).max(31),
    time: timeOfDay,
  }),
]);

export const reminderSettingsSchema = z.object({
  repeatEnabled: z.boolean(),
  repeatTimes: z.array(timeOfDay).max(12),
});

export const reminderDoneSchema = z.object({ dueDate: isoDate, done: z.boolean() });

/** "Realizado ✅" / "Fatura paga ✅" from a notification: only the signed token, no session. */
export const actionTokenSchema = z.object({ token: z.string().min(10).max(2000) });

/** Body of "enviar notificação de teste": one device, or all of them. */
export const pushTestSchema = z.object({ deviceId: z.uuid().optional() });

/** The person's Pluggy key (Open Finance), as copied from dashboard.pluggy.ai. */
export const bankKeySchema = z.object({
  clientId: z.string().trim().min(1).max(200),
  clientSecret: z.string().trim().min(1).max(500),
});

/** Open Finance alerts: what to tell and the minimum amount. */
export const bankAlertsSchema = z.object({
  expenses: z.boolean(),
  incomes: z.boolean(),
  silent: z.boolean(),
});

/** The transactions of one line of "Confira os gastos" (a split purchase brings all its instalments). */
const reviewIds = z.array(z.string().min(1).max(100)).min(1).max(48);

/** A decision about one line of "Confira os gastos". */
export const bankReviewActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('expense'), transactionIds: reviewIds, month: monthKeySchema, expense: expenseSchema }),
  z.object({
    action: z.literal('plan'),
    transactionIds: reviewIds,
    plan: installmentPlanSchema,
    // "Trocar por parcelado": the expense entered "à vista" that the plan replaces.
    replaces: z.object({ month: monthKeySchema, entryId: z.string().min(1).max(100) }).optional(),
  }),
  z.object({ action: z.literal('income'), transactionIds: reviewIds, month: monthKeySchema, income: incomeSchema }),
  z.object({
    action: z.literal('linked'),
    transactionIds: reviewIds,
    month: monthKeySchema,
    entryId: z.string().min(1).max(100),
  }),
  z.object({
    action: z.literal('reimbursed'),
    transactionIds: reviewIds,
    month: monthKeySchema,
    expenseId: z.string().min(1).max(100),
  }),
  z.object({ action: z.literal('ignore'), transactionIds: reviewIds }),
  // "Voltar para conferir": only ignored transactions.
  z.object({ action: z.literal('restore'), transactionIds: reviewIds }),
  // "Procurar nos gastos": tie a line by hand to one or more entries (in full or in part), or undo it.
  z.object({
    action: z.literal('link'),
    transactionIds: reviewIds,
    entries: z
      .array(z.object({ month: monthKeySchema, entryId: z.string().min(1).max(100) }))
      .min(1)
      .max(10),
  }),
  z.object({ action: z.literal('unlink'), transactionIds: reviewIds }),
  // "Pôr no Nubank": the entry of a card purchase goes to the card the bank says (null: "Não
  // informado"). Its line may be decided already, so it may carry no transaction to tie.
  z.object({
    action: z.literal('card'),
    transactionIds: z.array(z.string().min(1).max(100)).max(48),
    entry: z.enum(['expense', 'plan']),
    month: monthKeySchema.nullable(),
    entryId: z.string().min(1).max(100),
    cardId: z.string().min(1).max(100).nullable(),
  }),
  z.object({ action: z.literal('bill'), transactionIds: reviewIds }),
]);

/** Which Capital card a bank card is (null: "não informado"). */
export const bankCardLinkSchema = z.object({ cardId: z.string().min(1).max(100).nullable() });

/** What feeds the Reserva: the ids of the marked accounts and investments. */
export const bankReserveSchema = z.object({
  accounts: z.array(z.string().min(1).max(100)).max(50),
  investments: z.array(z.string().min(1).max(100)).max(300),
});

/** A bank's name in the Capital; empty goes back to the suggested one. */
export const bankRenameSchema = z.object({
  name: z
    .string()
    .trim()
    .max(60)
    .transform((name) => name || null),
});

/** A failed analysis as the app saw it, for the server log. */
export const aiProblemReportSchema = z.object({
  kind: z.enum(['audio', 'text']),
  detail: z.string().max(500),
});

/** Body of "fechar mês": whether to open the next month in the same transaction. */
export const closeMonthSchema = z.object({
  openNext: z.boolean().optional(),
  dropLeftovers: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Diagrama
// ---------------------------------------------------------------------------

const questionTypeSchema = z.enum(QUESTION_TYPES as [QuestionType, ...QuestionType[]]);
const fixedIncomeTypeSchema = z.enum(['fixedIncome', 'intlFixedIncome']);
const assetTypeSchema = z.enum(ASSET_TYPE_KEYS as [AssetType, ...AssetType[]]);
const ratio = z.number().min(0).max(1);
const diagramAmount = z.number().min(0).max(1_000_000_000_000);
const optionalLabel = (max: number) => z.string().max(max).nullable().optional();

/** The target of each type in the portfolio; a type left out is not in it. */
export const diagramTargetsSchema = z.object({
  targets: partialMap(ASSET_TYPE_KEYS, ratio) as z.ZodType<DiagramTargets>,
});

export const diagramLastAmountSchema = z.object({ amount: diagramAmount });

export const diagramFixedIncomeSchema = z.object({
  amount: diagramAmount,
  date: isoDate,
  score: z.number().min(-1).max(1).optional(),
});

export const diagramAssetSchema = z.object({
  type: assetTypeSchema,
  ticker: z.string().trim().min(1).max(30),
  quantity: diagramAmount,
  sector: optionalLabel(100),
  subsector: optionalLabel(100),
  note: optionalLabel(500),
  stopBuying: z.boolean(),
  isEtf: z.boolean(),
  directScore: z.number().min(-1).max(1).nullable(),
  /** Today, on the person's device: the date of the quantity. */
  date: isoDate,
});

export const diagramStopBuyingSchema = z.object({ stopBuying: z.boolean() });

export const diagramAnswerSchema = z.object({
  questionId: z.string().min(1).max(100),
  answer: z.union([z.literal(1), z.literal(-1), z.null()]),
});

const questionFields = {
  criterion: z.string().trim().min(1, 'Escreva o critério.').max(40),
  text: z.string().trim().min(1, 'Escreva a pergunta.').max(300),
  help: z.string().max(600).nullable().optional(),
  weight: z.number().min(0).max(100),
};

const autoKindSchema = z.enum(['graham', 'pvp']);

export const diagramQuestionSchema = z.object({ type: questionTypeSchema, ...questionFields });
export const diagramQuestionUpdateSchema = z.object({ ...questionFields, auto: autoKindSchema.nullable().optional() });
export const diagramAutoQuestionSchema = z.object({ kind: autoKindSchema });
export const diagramReorderSchema = z.object({
  type: questionTypeSchema,
  ids: z.array(z.string().min(1).max(100)).max(QUOTAS.diagramQuestions),
});
export const diagramRecommendedSchema = z.object({ type: questionTypeSchema });

export const diagramContributeSchema = z.object({
  date: isoDate,
  month: monthKeySchema,
  items: z
    .array(
      z.object({
        assetId: z.string().min(1).max(100).optional(),
        type: z.enum(ASSET_TYPE_KEYS as [AssetType, ...AssetType[]]),
        quantity: diagramAmount,
      }),
    )
    .min(1)
    .max(QUOTAS.diagramAssets + 2),
  launchExpense: z.boolean(),
});

const diagramBackupSchema = z.object({
  settings: z.object({
    targets: partialMap(ASSET_TYPE_KEYS, ratio) as z.ZodType<DiagramTargets>,
    lastAmount: diagramAmount.nullable(),
  }),
  assets: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        type: assetTypeSchema,
        ticker: z.string().min(1).max(30),
        quantity: diagramAmount,
        quantityUpdatedOn: isoDate.nullable(),
        sector: z.string().max(100).optional(),
        subsector: z.string().max(100).optional(),
        note: z.string().max(500).optional(),
        stopBuying: z.boolean(),
        isEtf: z.boolean(),
        directScore: z.number().min(-1).max(1).nullable(),
        position: z.number().int().min(0).max(100_000),
      }),
    )
    .max(QUOTAS.diagramAssets),
  fixedIncome: z
    .array(
      z.object({
        type: fixedIncomeTypeSchema,
        amount: diagramAmount,
        updatedOn: isoDate.nullable(),
        // Backups from before fixed income had funds: the total weighed 1.
        score: z.number().min(-1).max(1).default(1),
      }),
    )
    .max(2),
  questions: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        type: questionTypeSchema,
        criterion: z.string().max(40),
        text: z.string().max(300),
        help: z.string().max(600).optional(),
        auto: autoKindSchema.optional(),
        weight: z.number().min(0).max(100),
        position: z.number().int().min(0).max(100_000),
      }),
    )
    .max(QUOTAS.diagramQuestions),
  answers: z.record(
    z.string().max(100),
    z.record(z.string().max(100), z.union([z.literal(1), z.literal(-1)])),
  ),
  contributions: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        date: isoDate,
        amount: diagramAmount,
        items: z
          .array(
            z.object({
              type: z.enum(ASSET_TYPE_KEYS as [AssetType, ...AssetType[]]),
              assetId: z.string().max(100).optional(),
              ticker: z.string().max(30).optional(),
              quantity: diagramAmount,
              price: z.number().min(0).nullable(),
              amount: diagramAmount,
            }),
          )
          .max(QUOTAS.diagramAssets + 2),
      }),
    )
    .max(QUOTAS.diagramContributions),
}) satisfies z.ZodType<DiagramBackup>;

export const backupSchema = z.object({
  // v2 added the modules and the "A receber" category, v3 the (now obsolete) bottom bar, v4 the
  // tags; older files still import. The Diagrama came later and is optional: a backup without it
  // leaves the Diagrama as it is.
  version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  exportedAt: z.string(),
  settings: settingsSchema,
  months: z.array(monthDataSchema).max(1200),
  diagram: diagramBackupSchema.optional(),
});

/** Administração: make an account VIP or take it back. */
export const vipSchema = z.object({ vip: z.boolean() });

/** Administração: make a module only for VIP accounts ("Só VIP") or open it to everyone. */
export const moduleVipSchema = z.object({ vipOnly: z.boolean() });

/** Administração: a "Você sabia?". The link opens from everyone's phone, so only https. */
export const factSchema = z.object({
  text: z.string().trim().min(1).max(FACT_LIMITS.text),
  detail: z.string().trim().min(1).max(FACT_LIMITS.detail),
  sourceLabel: z.string().trim().min(1).max(FACT_LIMITS.sourceLabel),
  sourceUrl: z
    .string()
    .trim()
    .max(FACT_LIMITS.sourceUrl)
    .refine((value) => URL.canParse(value) && value.startsWith('https://'))
    .nullable(),
});
