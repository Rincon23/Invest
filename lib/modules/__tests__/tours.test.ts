// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODULE_KEYS } from '../catalog';
import { HOME_EDIT_TOUR, HOME_HELP_ANCHOR, MODULE_TOURS, homeEditTourSteps, tourSteps } from '../tours';

/** Every .tsx under components/, as one string, to look for the tour anchors. */
function componentSources(): string {
  const root = path.join(process.cwd(), 'components');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== '__tests__') walk(full);
      } else if (name.endsWith('.tsx')) files.push(full);
    }
  };
  walk(root);
  return files.map((file) => readFileSync(file, 'utf8')).join('\n');
}

describe('tours dos módulos', () => {
  it('todo módulo tem tour', () => {
    for (const key of MODULE_KEYS) expect(MODULE_TOURS[key].length).toBeGreaterThan(0);
  });

  it('é curto: até 4 passos por módulo, cada um com uma linha', () => {
    for (const key of MODULE_KEYS) {
      expect(MODULE_TOURS[key].length).toBeLessThanOrEqual(4);
      for (const step of MODULE_TOURS[key]) expect(step.description.length).toBeLessThanOrEqual(90);
    }
  });

  it('cada passo aponta para uma âncora que existe nas telas', () => {
    const sources = componentSources();
    const missing: string[] = [];
    for (const key of MODULE_KEYS) {
      for (const step of MODULE_TOURS[key]) {
        // The home cards get `card-<module>` from the card frame itself.
        const dynamicCard = step.anchor.startsWith('card-') && sources.includes('`card-${module}`');
        const literal = sources.includes(`"${step.anchor}"`) || sources.includes(`'${step.anchor}'`);
        if (!dynamicCard && !literal) missing.push(`${key}: ${step.anchor}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('todo módulo tem um botão de ajuda em algum lugar da tela', () => {
    const sources = componentSources();
    // The help button renders `data-tour={helpAnchor(module)}`; each module must place one.
    const missing = MODULE_KEYS.filter((key) => !sources.includes(`<ModuleHelpButton module="${key}"`));
    expect(missing).toEqual([]);
  });

  it('nunca aponta para a setinha nem para as bandejas da Início, que não são do módulo', () => {
    const anchors = MODULE_KEYS.flatMap((key) => MODULE_TOURS[key].map((step) => step.anchor));
    expect(anchors.filter((anchor) => anchor.startsWith('nav-'))).toEqual([]);
    const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');
    // The up-arrow's drawer carries no anchor at all.
    expect(read('components/layout/AppDrawer.tsx') + read('components/layout/MoreMenu.tsx')).not.toMatch(
      /\sdata-tour=/,
    );
    // The Início and its widget tray only carry the anchors of the Início's own tour (organizing
    // the telas), and no module's tour points at those.
    const homeAnchors = new Set([...HOME_EDIT_TOUR.map((step) => step.anchor), HOME_HELP_ANCHOR]);
    const chrome =
      read('components/modules/home/HomeScreen.tsx') + read('components/modules/home/WidgetTray.tsx');
    const literal = [...chrome.matchAll(/data-tour=\{?[^'"\n]*['"]([\w-]+)['"]/g)].map((match) => match[1]);
    expect(literal.filter((anchor) => !homeAnchors.has(anchor))).toEqual([]);
    expect(anchors.filter((anchor) => homeAnchors.has(anchor))).toEqual([]);
  });

  it('o tour de organizar a Início é curto, fica na tela em que está e termina no botão de ajuda', () => {
    expect(HOME_EDIT_TOUR.length).toBeLessThanOrEqual(4);
    for (const step of HOME_EDIT_TOUR) expect(step.description.length).toBeLessThanOrEqual(90);
    const sources = componentSources();
    const anchors = [...new Set(HOME_EDIT_TOUR.map((step) => step.anchor))];
    expect(
      anchors.filter((anchor) => !sources.includes(`'${anchor}'`) && !sources.includes(`"${anchor}"`)),
    ).toEqual([]);
    expect(sources).toContain('data-tour={HOME_HELP_ANCHOR}');
    const steps = homeEditTourSteps('/mes/2026-10');
    expect(steps.every((step) => step.href === '/mes/2026-10' && step.module === undefined)).toBe(true);
    expect(steps.at(-1)?.anchor).toBe(HOME_HELP_ANCHOR);
  });

  it('monta as rotas do mês e marca de qual módulo é cada passo', () => {
    const steps = tourSteps(['card', 'reimbursable'], '2026-09');
    expect(steps.map((step) => [step.module, step.href, step.anchor])).toEqual([
      ['card', '/cartao', 'cartao-fatura'],
      ['card', '/cartao?aba=parcelados', 'cartao-aba-parcelados'],
      ['card', '/cartao?aba=cartoes', 'cartao-aba-cartoes'],
      ['card', '/mes/2026-09', 'cartao-pergunta'],
      ['card', '/cartao', 'ajuda-card'],
      ['reimbursable', '/mes/2026-09', 'categoria-a-receber'],
      ['reimbursable', '/mes/2026-09/lancamentos?aba=a-receber', 'aba-a-receber'],
      ['reimbursable', '/mes/2026-09', 'card-reimbursable'],
      ['reimbursable', '/mes/2026-09/lancamentos?aba=a-receber', 'ajuda-reimbursable'],
    ]);
    // The card question is inside the expense form; the help button is not, so it closes first.
    expect(steps[3].sheet).toBe('expense-form');
    expect(steps[4].sheet).toBeUndefined();
  });

  it('o passo da aba Investimentos do Histórico só aparece com o Diagrama ligado', () => {
    const anchors = (isOn: (key: string) => boolean) =>
      tourSteps(['history'], '2026-10', isOn).map((step) => step.anchor);
    expect(anchors(() => false)).not.toContain('historico-investimentos');
    expect(anchors((key) => key === 'diagram')).toContain('historico-investimentos');
    expect(anchors(() => false).at(-1)).toBe('ajuda-history');
  });

  it('o tour do Cartão é um só, curto, e passa pelas três abas', () => {
    const anchors = MODULE_TOURS.card.map((step) => step.anchor);
    expect(anchors).toContain('cartao-fatura');
    expect(anchors).toContain('cartao-aba-parcelados');
    expect(anchors).toContain('cartao-aba-cartoes');
    expect(anchors.length).toBeLessThanOrEqual(4);
  });
});
