/**
 * Whether a sheet holds changes nobody saved yet — worked out from the page itself, so every form
 * gets it without keeping a copy of its own state.
 *
 * What is watched: each `<form>` in the sheet, plus any block marked `data-edit-scope` (an editor
 * with its own "Salvar" button, marked `data-edit-save`). Switches that save on the spot sit
 * outside of those and never count. A block may also say it outright with `data-edit-dirty`.
 * Anything inside `data-dirty-ignore` is left out (e.g. choosing which categories show first).
 *
 * The "before" picture of a block is taken at the person's first touch or key inside the sheet,
 * just before it changes anything: opening a sheet only to look never asks anything on the way out.
 */

const SCOPES = 'form, [data-edit-scope]';
const FIELDS = 'input, select, textarea, [aria-pressed], [aria-checked]';

function scopesIn(root: HTMLElement): HTMLElement[] {
  // The outermost blocks only: a form inside an editor is part of that editor.
  return Array.from(root.querySelectorAll<HTMLElement>(SCOPES)).filter(
    (scope) => !scope.parentElement?.closest(SCOPES),
  );
}

function picture(scope: HTMLElement): string {
  const parts: string[] = [];
  for (const field of scope.querySelectorAll<HTMLElement>(FIELDS)) {
    if (field.closest('[data-dirty-ignore]')) continue;
    if (field instanceof HTMLInputElement) {
      if (field.type === 'checkbox' || field.type === 'radio') parts.push(field.checked ? '☑' : '☐');
      else if (field.type !== 'search') parts.push(field.value);
    } else if (field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
      parts.push(field.value);
    } else if (
      field.getAttribute('aria-pressed') === 'true' ||
      field.getAttribute('aria-checked') === 'true'
    ) {
      // Chips and toggles: only the ones that are on, so a list that just unfolds changes nothing.
      parts.push(`✓${field.getAttribute('aria-label') ?? field.textContent ?? ''}`);
    }
  }
  return parts.join('␟');
}

export class UnsavedChanges {
  private before = new WeakMap<HTMLElement, string>();

  /** Called on the first touch or key of every gesture: remembers the blocks it has not seen yet. */
  remember(root: HTMLElement | null) {
    if (!root) return;
    for (const scope of scopesIn(root)) {
      if (!this.before.has(scope)) this.before.set(scope, picture(scope));
    }
  }

  private isDirty(scope: HTMLElement): boolean {
    const declared = scope.getAttribute('data-edit-dirty');
    if (declared !== null) return declared === 'true';
    const before = this.before.get(scope);
    return before !== undefined && before !== picture(scope);
  }

  dirtyScopes(root: HTMLElement | null): HTMLElement[] {
    return root ? scopesIn(root).filter((scope) => this.isDirty(scope)) : [];
  }

  /** Whether "Salvar" has anything to press: a form, or an editor with its own save button. */
  canSave(root: HTMLElement | null): boolean {
    return this.dirtyScopes(root).every(
      (scope) => scope instanceof HTMLFormElement || scope.querySelector('[data-edit-save]') !== null,
    );
  }

  /** Saves every changed block the way its own button would. */
  save(root: HTMLElement | null) {
    for (const scope of this.dirtyScopes(root)) {
      if (scope instanceof HTMLFormElement) scope.requestSubmit();
      else scope.querySelector<HTMLButtonElement>('[data-edit-save]')?.click();
    }
  }
}
