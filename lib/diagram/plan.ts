import { buyWeight } from './score';
import type { AssetType, DiagramTargets } from './types';

/**
 * The aporte: how much of an amount goes to each type and each asset. Pure — the screen calls it
 * on every change and the tests call it with the owner's spreadsheet.
 *
 * - `V` is what is invested now (the types in the portfolio), `A` the aporte, `T = V + A`.
 * - An asset weighs `max(0, score)`, or 0 with "Não compro mais" (never bought).
 * - A type's target in R$ is `target × T`. The assets marked "Não compro mais" still fill it:
 *   only what is left (target − their value, never below 0) is split among the assets that
 *   receive, by weight. A fixed-income total is the only asset of its type and gets all of it.
 * - A type never receives more than it lacks for its own target, whatever its assets lack: with
 *   the "Não compro mais" ones above it, nobody in that type is bought until it is back below.
 * - A type with a target but nobody who can receive hands its target to the other types, in
 *   proportion to their targets (and the screen says so).
 * - `A` goes first to whoever is furthest below their target, levelling them (what the owner did
 *   by hand with the spreadsheet's "prioridade"), then is rounded down to whole quotas; what is
 *   left buys one quota at a time of the asset with the biggest gap whose price still fits, and
 *   the fractional assets and fixed income take the cents. Never sells, never spends more than
 *   `A`, never buys an asset that weighs 0.
 */

/** A whole-quota asset, a fractional one (international, crypto) or a fixed-income total in R$. */
export type PositionUnit = 'quota' | 'money';

export interface PlanPosition {
  /** The asset's id, or the fixed-income type's key. */
  id: string;
  type: AssetType;
  /** The ticker, or the type's name for a fixed-income total. */
  label: string;
  /** What it is worth now, in R$ (0 when it has no price). */
  value: number;
  /** R$ per quota; null for a fixed-income total and for an asset no source could price. */
  price: number | null;
  /** 0 = whole quotas only; more = how many decimals of a quota can be bought. */
  fractionDigits: number;
  unit: PositionUnit;
  /** −1..1, or null when not evaluated yet (a fixed-income total without one weighs 1). */
  score: number | null;
  stopBuying: boolean;
}

export interface PlanInput {
  /** The aporte, in R$. */
  amount: number;
  /** Only the types that are keys here count; the positions of other types are left out. */
  targets: DiagramTargets;
  positions: PlanPosition[];
}

/** Why an asset receives nothing. */
export type BlockReason =
  | 'stopped'
  | 'noScore'
  | 'lowScore'
  | 'noPrice'
  /** Its type is in the portfolio at 0%. */
  | 'typeOff'
  /** Its type has a target but cannot receive (it went to the other types). */
  | 'typeRedistributed'
  /** Already at (or above) its target, or its type is. */
  | 'atTarget'
  /** It has room, but the money went to whoever was further away (or its quota did not fit). */
  | 'waiting';

/** Why a type with a target cannot receive anything. */
export type OrphanReason = 'empty' | 'stopped' | 'noScore' | 'lowScore' | 'noPrice' | 'mixed';

/** Why money was left over. */
export type LeftoverReason =
  | { kind: 'none' }
  /** The cheapest quota of the asset that still needs it costs more than what is left. */
  | { kind: 'quotaTooExpensive'; id: string; label: string; price: number }
  /** Every asset that can receive reached its target. */
  | { kind: 'allAtTarget' }
  /** Nobody in the portfolio can receive. */
  | { kind: 'noReceivers' }
  /** The person took quotas out with "−": the money is still there to put elsewhere. */
  | { kind: 'unspent' };

export interface PlanLine {
  id: string;
  type: AssetType;
  label: string;
  unit: PositionUnit;
  price: number | null;
  fractionDigits: number;
  value: number;
  /** Its weight inside the type (0 = does not receive). */
  weight: number;
  /** Its target in R$, on the portfolio after the aporte (0 when it does not receive). */
  target: number;
  /** How many quotas (or R$, for a fixed-income total) go to it. */
  quantity: number;
  /** In R$. */
  amount: number;
  /** Why it receives nothing; null while it is in the plan (even if it got 0 by now). */
  blocked: BlockReason | null;
}

export interface PlanType {
  type: AssetType;
  /** The person's target (0..1). */
  target: number;
  /** After the targets of the types that cannot receive were handed over (0..1). */
  effectiveTarget: number;
  /** Set when the type has a target but nobody in it can receive. */
  orphan: OrphanReason | null;
  /** What the type is worth now (every asset in it, "Não compro mais" included). */
  value: number;
  /** Its target in R$, on the portfolio after the aporte. */
  targetValue: number;
  amount: number;
}

export interface Plan {
  /** `A`. */
  amount: number;
  /** `V`: what the portfolio is worth now. */
  invested: number;
  /** What the plan buys. */
  spent: number;
  /** `A − spent`; never negative in a suggestion. */
  leftover: number;
  leftoverReason: LeftoverReason;
  lines: PlanLine[];
  types: PlanType[];
}

/** Below this, a difference in R$ is float noise or less than a cent. */
const EPSILON = 0.005;

function floorTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  // The tiny nudge keeps 2.9999999997 (float noise of 3) from flooring to 2.
  return Math.floor(value * factor + 1e-7) / factor;
}

function floorCents(value: number): number {
  return floorTo(value, 2);
}

/** What `quantity` of a position costs in R$. */
export function lineCost(position: Pick<PlanPosition, 'unit' | 'price'>, quantity: number): number {
  if (position.unit === 'money') return quantity;
  return position.price === null ? 0 : quantity * position.price;
}

/** How much of `money` buys of a position, rounded down to what can really be bought. */
function quantityFor(position: PlanPosition, money: number): number {
  if (money <= 0) return 0;
  if (position.unit === 'money') return floorCents(money);
  if (position.price === null || position.price <= 0) return 0;
  return floorTo(money / position.price, position.fractionDigits);
}

/** Can this position receive at all (before looking at targets)? */
/** A fixed-income total without a score weighs 1, as it did when it was the type's only asset. */
function scoreOf(position: PlanPosition): number | null {
  return position.unit === 'money' ? (position.score ?? 1) : position.score;
}

function receives(position: PlanPosition): boolean {
  const weight = buyWeight(scoreOf(position), position.stopBuying);
  if (position.unit === 'money') return weight > 0;
  return position.price !== null && position.price > 0 && weight > 0;
}

function weightOf(position: PlanPosition): number {
  return buyWeight(scoreOf(position), position.stopBuying);
}

function ownBlock(position: PlanPosition): BlockReason | null {
  if (position.unit === 'money') return (scoreOf(position) ?? 0) <= 0 ? 'lowScore' : null;
  if (position.stopBuying) return 'stopped';
  if (position.score === null) return 'noScore';
  if (position.score <= 0) return 'lowScore';
  if (position.price === null || position.price <= 0) return 'noPrice';
  return null;
}

function orphanReason(positions: PlanPosition[]): OrphanReason {
  if (positions.length === 0) return 'empty';
  const reasons = new Set(positions.map((position) => ownBlock(position)));
  if (reasons.size === 1) {
    const [only] = reasons;
    if (only === 'stopped' || only === 'noScore' || only === 'lowScore' || only === 'noPrice') return only;
  }
  // Everything blocked for the same reason except the ones the person stopped buying.
  const notStopped = positions.filter((position) => !position.stopBuying);
  const rest = new Set(notStopped.map((position) => ownBlock(position)));
  if (rest.size === 1) {
    const [only] = rest;
    if (only === 'noScore' || only === 'lowScore' || only === 'noPrice') return only;
  }
  return 'mixed';
}

/**
 * Formula 1.2 of the owner's spreadsheet: inside each type, an asset's share of the portfolio is
 * `weight / Σ weights of the type × target of the type` (score 1 gets twice what 0,5 gets).
 * Without the "Não compro mais" rule — the conferência of the spreadsheet uses this alone.
 */
export function splitByScore(
  targets: DiagramTargets,
  items: { id: string; type: AssetType; weight: number }[],
): Record<string, number> {
  const totals = new Map<AssetType, number>();
  for (const item of items) totals.set(item.type, (totals.get(item.type) ?? 0) + Math.max(0, item.weight));
  const shares: Record<string, number> = {};
  for (const item of items) {
    const total = totals.get(item.type) ?? 0;
    shares[item.id] = total > 0 ? (Math.max(0, item.weight) / total) * (targets[item.type] ?? 0) : 0;
  }
  return shares;
}

interface Frame {
  positions: PlanPosition[];
  invested: number;
  types: PlanType[];
  /** By position id. */
  targets: Map<string, number>;
  blocks: Map<string, BlockReason | null>;
}

/** Targets in R$ for every position, after the orphan types handed theirs over. */
function frame(input: PlanInput): Frame {
  const amount = Math.max(0, input.amount);
  const positions = input.positions.filter((position) => input.targets[position.type] !== undefined);
  const invested = positions.reduce((sum, position) => sum + Math.max(0, position.value), 0);
  const base = invested + amount;

  const inUse = (Object.keys(input.targets) as AssetType[]).filter((type) => input.targets[type] !== undefined);
  const byType = new Map<AssetType, PlanPosition[]>(inUse.map((type) => [type, []]));
  for (const position of positions) byType.get(position.type)?.push(position);

  const orphans = new Map<AssetType, OrphanReason>();
  for (const type of inUse) {
    const list = byType.get(type) ?? [];
    if ((input.targets[type] ?? 0) > 0 && !list.some(receives)) orphans.set(type, orphanReason(list));
  }

  const receivingTotal = inUse
    .filter((type) => !orphans.has(type))
    .reduce((sum, type) => sum + (input.targets[type] ?? 0), 0);
  const orphanTotal = [...orphans.keys()].reduce((sum, type) => sum + (input.targets[type] ?? 0), 0);

  const targets = new Map<string, number>();
  const blocks = new Map<string, BlockReason | null>();
  const types: PlanType[] = [];

  for (const type of inUse) {
    const target = input.targets[type] ?? 0;
    const orphan = orphans.get(type) ?? null;
    const effectiveTarget =
      orphan || receivingTotal <= 0 ? 0 : target + (orphanTotal * target) / receivingTotal;
    const list = byType.get(type) ?? [];
    const stoppedValue = list
      .filter((position) => position.unit !== 'money' && position.stopBuying)
      .reduce((sum, position) => sum + Math.max(0, position.value), 0);
    const free = Math.max(0, effectiveTarget * base - stoppedValue);
    const weights = list.reduce((sum, position) => sum + (receives(position) ? weightOf(position) : 0), 0);

    for (const position of list) {
      const own = ownBlock(position);
      if (target <= 0) blocks.set(position.id, own ?? 'typeOff');
      else if (orphan) blocks.set(position.id, own ?? 'typeRedistributed');
      else blocks.set(position.id, own);
      targets.set(
        position.id,
        !blocks.get(position.id) && weights > 0 ? (weightOf(position) / weights) * free : 0,
      );
    }
    types.push({
      type,
      target,
      effectiveTarget,
      orphan,
      value: list.reduce((sum, position) => sum + Math.max(0, position.value), 0),
      targetValue: effectiveTarget * base,
      amount: 0,
    });
  }

  return { positions, invested, types, targets, blocks };
}

/**
 * Levels `amount` across the gaps: everybody ends at most `level` below their target, the biggest
 * gaps filled first. Returns what each one gets (never more than its gap).
 */
function level(gaps: Map<string, number>, amount: number): Map<string, number> {
  const entries = [...gaps.entries()].filter(([, gap]) => gap > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, gap]) => sum + gap, 0);
  const result = new Map<string, number>();
  if (total <= amount) {
    for (const [id, gap] of entries) result.set(id, gap);
    return result;
  }
  let running = 0;
  let waterline = 0;
  for (let k = 0; k < entries.length; k += 1) {
    running += entries[k][1];
    const candidate = (running - amount) / (k + 1);
    const next = entries[k + 1]?.[1] ?? 0;
    if (candidate >= next) {
      waterline = Math.max(0, candidate);
      break;
    }
  }
  for (const [id, gap] of entries) result.set(id, Math.max(0, gap - waterline));
  return result;
}

/** The suggestion: how many quotas (or R$, for fixed income) each position gets. */
export function suggestQuantities(input: PlanInput): Record<string, number> {
  const amount = Math.max(0, input.amount);
  const { positions, types, targets, blocks } = frame(input);
  const receivers = positions.filter((position) => blocks.get(position.id) === null);
  const quantities: Record<string, number> = {};
  for (const position of positions) quantities[position.id] = 0;
  if (amount <= 0 || receivers.length === 0) return quantities;

  const spent = new Map<string, number>();
  const spentInType = new Map<AssetType, number>();
  const typeOf = new Map(types.map((type) => [type.type, type]));
  /** What the asset still lacks for its own target. */
  const gapOf = (position: PlanPosition) =>
    (targets.get(position.id) ?? 0) - Math.max(0, position.value) - (spent.get(position.id) ?? 0);
  /** What its type still lacks: a type above its target takes nothing, whatever its assets lack. */
  const roomOf = (type: AssetType) => {
    const entry = typeOf.get(type);
    return entry ? entry.targetValue - entry.value - (spentInType.get(type) ?? 0) : 0;
  };
  const buy = (position: PlanPosition, quantity: number) => {
    const cost = lineCost(position, quantity);
    quantities[position.id] = roundQuantity(position, quantities[position.id] + quantity);
    spent.set(position.id, (spent.get(position.id) ?? 0) + cost);
    spentInType.set(position.type, (spentInType.get(position.type) ?? 0) + cost);
    return cost;
  };

  // Inside each type, the room is first levelled among its assets; then the aporte is levelled
  // across everybody, so the furthest from the target (asset and type) are filled first.
  const capped = new Map<string, number>();
  for (const type of types) {
    const own = receivers.filter((position) => position.type === type.type);
    const share = level(new Map(own.map((position) => [position.id, gapOf(position)])), Math.max(0, roomOf(type.type)));
    for (const [id, gap] of share) capped.set(id, gap);
  }
  const ideal = level(capped, amount);
  let left = amount;
  for (const position of receivers) left -= buy(position, quantityFor(position, ideal.get(position.id) ?? 0));

  // One whole quota at a time: the biggest gap whose quota still fits.
  const whole = receivers.filter((position) => position.unit === 'quota' && position.fractionDigits === 0);
  for (;;) {
    let best: PlanPosition | null = null;
    let bestGap = 0;
    for (const position of whole) {
      const gap = gapOf(position);
      if (
        gap > EPSILON &&
        gap > bestGap &&
        roomOf(position.type) > EPSILON &&
        (position.price ?? Infinity) <= left + 1e-9
      ) {
        best = position;
        bestGap = gap;
      }
    }
    if (!best) break;
    left -= buy(best, 1);
  }

  // The fractional assets and the fixed-income totals take what is left, up to their gap.
  const absorbers = receivers
    .filter((position) => position.unit === 'money' || position.fractionDigits > 0)
    .sort((a, b) => gapOf(b) - gapOf(a));
  for (const position of absorbers) {
    if (left <= EPSILON) break;
    const room = Math.min(gapOf(position), roomOf(position.type), left);
    if (room <= EPSILON) continue;
    const extra = quantityFor(position, room);
    if (extra > 0) left -= buy(position, extra);
  }

  return quantities;
}

function roundQuantity(position: PlanPosition, quantity: number): number {
  const digits = position.unit === 'money' ? 2 : position.fractionDigits;
  return Math.round(quantity * 10 ** digits) / 10 ** digits;
}

/**
 * The plan for these quantities — the suggestion, or the suggestion after the person moved a
 * line with − / +. Everything the screen shows (R$, % today → after → target, the leftover and why
 * it is there) comes from here, so it changes live.
 */
export function buildPlan(input: PlanInput, quantities: Record<string, number>): Plan {
  const amount = Math.max(0, input.amount);
  const { positions, invested, types, targets, blocks } = frame(input);

  const lines: PlanLine[] = positions.map((position) => {
    const blocked = blocks.get(position.id) ?? null;
    const quantity = blocked ? 0 : Math.max(0, quantities[position.id] ?? 0);
    return {
      id: position.id,
      type: position.type,
      label: position.label,
      unit: position.unit,
      price: position.price,
      fractionDigits: position.fractionDigits,
      value: Math.max(0, position.value),
      weight: blocked ? 0 : weightOf(position),
      target: targets.get(position.id) ?? 0,
      quantity,
      amount: lineCost(position, quantity),
      blocked,
    };
  });

  for (const type of types) {
    type.amount = lines.filter((line) => line.type === type.type).reduce((sum, line) => sum + line.amount, 0);
  }

  // A line that receives but got nothing is "at target" or "waiting" for the screen.
  for (const line of lines) {
    if (line.blocked || line.quantity > 0) continue;
    const type = types.find((entry) => entry.type === line.type);
    const typeFull = !type || type.targetValue - type.value <= EPSILON;
    line.blocked = typeFull || line.target - line.value <= EPSILON ? 'atTarget' : 'waiting';
  }

  const spent = lines.reduce((sum, line) => sum + line.amount, 0);
  const leftover = amount - spent;
  return {
    amount,
    invested,
    spent,
    leftover: Math.abs(leftover) < 1e-9 ? 0 : leftover,
    leftoverReason: leftoverReason(lines, types, leftover),
    lines,
    types,
  };
}

function leftoverReason(lines: PlanLine[], types: PlanType[], leftover: number): LeftoverReason {
  if (leftover < 0.01) return { kind: 'none' };
  const receiving = lines.filter(
    (line) => !line.blocked || line.blocked === 'atTarget' || line.blocked === 'waiting',
  );
  if (receiving.length === 0) return { kind: 'noReceivers' };

  const typeRoom = (line: PlanLine) => {
    const type = types.find((entry) => entry.type === line.type);
    return type ? type.targetValue - type.value - type.amount : 0;
  };
  const withGap = receiving.filter(
    (line) => line.target - line.value - line.amount > EPSILON && typeRoom(line) > EPSILON,
  );
  if (withGap.length === 0) return { kind: 'allAtTarget' };

  // Something with a gap could still take it: the money is unspent (a manual "−").
  const fits = withGap.some(
    (line) => line.unit === 'money' || line.fractionDigits > 0 || (line.price ?? Infinity) <= leftover + 1e-9,
  );
  if (fits) return { kind: 'unspent' };

  const biggest = withGap.reduce((best, line) =>
    line.target - line.value - line.amount > best.target - best.value - best.amount ? line : best,
  );
  return { kind: 'quotaTooExpensive', id: biggest.id, label: biggest.label, price: biggest.price ?? 0 };
}

/** The suggestion and its plan, in one call. */
export function suggestContribution(input: PlanInput): { quantities: Record<string, number>; plan: Plan } {
  const quantities = suggestQuantities(input);
  return { quantities, plan: buildPlan(input, quantities) };
}

/** Each type's share of the portfolio after the plan (0..1), for the "Carteira depois" chart. */
export function sharesAfter(plan: Plan): { type: AssetType; share: number }[] {
  const total = plan.invested + plan.spent;
  return plan.types.map((type) => ({
    type: type.type,
    share: total > 0 ? (type.value + type.amount) / total : 0,
  }));
}

/** One step of the "−" / "+" of a line: one quota, or R$ 10 for fractions and fixed income. */
export function stepQuantity(line: PlanLine, direction: 1 | -1, leftover: number): number {
  if (line.unit === 'quota' && line.fractionDigits === 0) {
    if (direction < 0) return Math.max(0, line.quantity - 1);
    return (line.price ?? Infinity) <= leftover + 1e-9 ? line.quantity + 1 : line.quantity;
  }
  const step = 10;
  if (line.unit === 'money') {
    if (direction < 0) return Math.max(0, floorCents(line.quantity - step));
    return floorCents(line.quantity + Math.min(step, Math.max(0, leftover)));
  }
  if (line.price === null || line.price <= 0) return line.quantity;
  const delta = direction < 0 ? -step : Math.min(step, Math.max(0, leftover));
  return Math.max(0, floorTo((line.amount + delta) / line.price, line.fractionDigits));
}
