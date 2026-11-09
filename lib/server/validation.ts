import { z } from 'zod';
import type { HomeWidgetKey, ModuleKey } from '@/lib/core';
import { HOME_WIDGET_KEYS, MAX_HOME_PAGES, MAX_WIDGETS_PER_HOME_PAGE, MODULE_KEYS } from '@/lib/modules';
import {
  ASSET_TYPE_KEYS,
  QUESTION_TYPES,
  type AssetType,
  type DiagramBackup,
  type DiagramTargets,
  type QuestionType,
} from '@/lib/diagram';
import { isAllowedPushEndpoint, type NotificationCategory } from '@/lib/notifications';
import { QUOTAS } from './quotas';

const NOTIFICATION_CATEGORIES: NotificationCategory[] = ['banks', 'feature', 'system'];

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

/** A real calendar day ("2024-02-30" is refused). */
export const isoDate = z.iso.date('Data inválida.');

const modulesSchema = z.object(
  Object.fromEntries(MODULE_KEYS.map((key) => [key, z.boolean().optional()])) as Record<
    ModuleKey,
    z.ZodOptional<z.ZodBoolean>
  >,
);

/** A widget of the Início: a module's card (lib/modules/home.ts). Unknown ones are dropped. */
const homeWidgetList = (max: number) =>
  z.preprocess(
    (value) =>
      Array.isArray(value) ? value.filter((key) => HOME_WIDGET_KEYS.includes(key as HomeWidgetKey)) : value,
    z.array(z.enum(HOME_WIDGET_KEYS as [HomeWidgetKey, ...HomeWidgetKey[]])).max(max),
  );

export const settingsSchema = z.object({
  onboardingCompleted: z.boolean().optional(),
  modules: modulesSchema.optional(),
  dismissedNotices: z.array(z.string().min(1).max(60)).max(200).optional(),
  notificationPrefs: partialMap(NOTIFICATION_CATEGORIES, z.boolean()).optional(),
  homePages: z.array(homeWidgetList(MAX_WIDGETS_PER_HOME_PAGE)).max(MAX_HOME_PAGES).nullable().optional(),
  homeCardSizes: partialMap(HOME_WIDGET_KEYS, z.enum(['half', 'full'])).optional(),
  homeHidden: homeWidgetList(50).optional(),
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

/** Body of "enviar notificação de teste": one device, or all of them. */
export const pushTestSchema = z.object({ deviceId: z.uuid().optional() });

/** The person's Pluggy key (Open Finance), as copied from dashboard.pluggy.ai. */
export const bankKeySchema = z.object({
  clientId: z.string().trim().min(1).max(200),
  clientSecret: z.string().trim().min(1).max(500),
});

/** A bank's name in the app; empty goes back to the suggested one. */
export const bankRenameSchema = z.object({
  name: z
    .string()
    .trim()
    .max(60)
    .transform((name) => name || null),
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
  outside: z
    .array(
      z.object({
        ticker: z.string().trim().min(1).max(20),
        quantity: z.number().positive().max(1e12).nullable(),
      }),
    )
    .max(QUOTAS.diagramAssets)
    .optional(),
}) satisfies z.ZodType<DiagramBackup>;

export const backupSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  settings: settingsSchema,
  diagram: diagramBackupSchema,
});

/** "Fora do Diagrama": a B3 ticker, and all of it (null) or that many shares. */
export const diagramOutsideSchema = z.object({
  ticker: z.string().trim().min(1).max(20),
  quantity: z.number().positive().max(1e12).nullable(),
});

/** Administração: give an account access to the restricted modules or take it back. */
export const vipSchema = z.object({ vip: z.boolean() });

/** Administração: make a module restricted ("Restrito") or open it to everyone. */
export const moduleVipSchema = z.object({ vipOnly: z.boolean() });

/** The quote service (Capital + asks it, over the Docker network): the tickers it wants priced. */
export const quoteServiceSchema = z.object({
  tickers: z.array(z.string().trim().min(1).max(20)).min(1).max(50),
});
