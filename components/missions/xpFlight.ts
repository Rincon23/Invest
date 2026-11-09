/** A point on the screen, in viewport pixels. */
export interface ScreenPoint {
  x: number;
  y: number;
}

const PILL_MS = 800;
const DOT_MS = 650;
const DOTS = 5;
const DOT_DELAY_MS = 70;
/** Points along the curve: enough for it to look round. */
const STEPS = 16;

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** The middle of `element` on the screen. */
export function centerOf(element: Element): ScreenPoint {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * The tree the XP flies to (`data-xp-target`, on the Missões bar of the Início), when it is really
 * on screen: in the viewport and not under a sheet or the app drawer (what is drawn at its middle
 * is the tree itself).
 */
export function xpTarget(): HTMLElement | null {
  const target = document.querySelector<HTMLElement>('[data-xp-target]');
  if (!target || typeof document.elementFromPoint !== 'function') return null;
  const { x, y } = centerOf(target);
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return null;
  const top = document.elementFromPoint(x, y);
  return top && target.contains(top) ? target : null;
}

/** A quadratic curve from `from` to `to`, bulging up (and sideways when they are on one line). */
function curve(from: ScreenPoint, to: ScreenPoint, bend: number): (t: number) => ScreenPoint {
  const control = {
    x: (from.x + to.x) / 2 + bend,
    y: Math.max(12, Math.min(from.y, to.y) - 70 - Math.abs(bend) / 2),
  };
  return (t) => ({
    x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t ** 2 * to.x,
    y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t ** 2 * to.y,
  });
}

/** Moves `element` (placed with its middle on `from`) along the curve, shrinking as it arrives. */
function fly(element: HTMLElement, from: ScreenPoint, to: ScreenPoint, bend: number, ms: number, delay: number) {
  const at = curve(from, to, bend);
  const frames: Keyframe[] = [];
  for (let step = 0; step <= STEPS; step += 1) {
    const point = at(easeInOut(step / STEPS));
    const progress = step / STEPS;
    // A little pop as it leaves, then smaller all the way, gone as it enters the tree.
    const scale = progress < 0.15 ? 1 + progress * 1.4 : 1.2 - progress * 0.85;
    frames.push({
      transform: `translate(${point.x - from.x}px, ${point.y - from.y}px) scale(${scale})`,
      opacity: progress < 0.8 ? 1 : (1 - progress) / 0.2,
    });
  }
  return element.animate(frames, { duration: ms, delay, easing: 'linear', fill: 'both' }).finished;
}

function placed(className: string, at: ScreenPoint): HTMLElement {
  const element = document.createElement('span');
  element.className = className;
  element.style.left = `${at.x}px`;
  element.style.top = `${at.y}px`;
  return element;
}

/**
 * The XP of what was just done leaving `from` (where the person tapped) as "+10 XP", with a few
 * sparks behind it, and flying in a curve into the tree of the Missões bar, which hops when it
 * gets there. Resolves when it lands — the moment the bar should fill. Null when nothing flies
 * (no `animate`, or the person asked the system for less motion): the caller says it in words.
 */
export function flyXp(xp: number, from: ScreenPoint, target: HTMLElement): Promise<void> | null {
  if (typeof target.animate !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return null;
  }
  const to = centerOf(target);
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.className = 'pointer-events-none fixed inset-0 z-[60]';

  const pill = placed(
    'bg-success-fill absolute rounded-full px-2.5 py-1 text-sm font-bold whitespace-nowrap text-white shadow-lg tabular-nums',
    from,
  );
  pill.textContent = `+${xp} XP`;
  // Centered on the point by its own size (`translate` adds to the flight's `transform`).
  pill.style.translate = '-50% -50%';
  layer.append(pill);

  const sparks: Promise<unknown>[] = [];
  for (let index = 0; index < DOTS; index += 1) {
    const start = { x: from.x + (index - (DOTS - 1) / 2) * 6, y: from.y + ((index % 2) * 2 - 1) * 4 };
    const dot = placed('bg-success-fill absolute h-2 w-2 rounded-full', start);
    dot.style.translate = '-50% -50%';
    layer.append(dot);
    const bend = (index - (DOTS - 1) / 2) * 28;
    sparks.push(fly(dot, start, to, bend, DOT_MS, (index + 1) * DOT_DELAY_MS).catch(() => undefined));
  }
  document.body.append(layer);

  const landed = fly(pill, from, to, 0, PILL_MS, 0)
    .catch(() => undefined)
    .then(() => {
      target.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(0.95)' }, { transform: 'scale(1)' }],
        { duration: 420, easing: 'ease-out' },
      );
    });
  void Promise.all([landed, ...sparks]).then(() => layer.remove());
  return landed;
}
