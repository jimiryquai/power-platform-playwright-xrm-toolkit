import { describe, it, expect, vi } from 'vitest';
import type { Page } from '@playwright/test';
import {
  DialogHandler,
  DialogKind,
  DIALOG_SELECTORS,
  DuplicateRecordsFoundError,
} from './dialog-handler';

/**
 * Page stub whose waitForSelector resolves only for selectors we say are on screen.
 *
 * A selector that never appears rejects once its timeout elapses, matching real
 * Playwright — the handler's behaviour depends on that rejection, so a stub that
 * merely hung would not exercise it. The timer is unref'd so a long timeout does
 * not hold the process open after the test finishes.
 */
function createPageStub(visible: string[] = []) {
  const clicked: string[] = [];
  const page = {
    waitForSelector: vi.fn((selector: string, options?: { timeout?: number }) => {
      if (visible.includes(selector)) {
        return Promise.resolve({
          click: () => {
            clicked.push(selector);
            return Promise.resolve();
          },
        });
      }
      return new Promise((_resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Timeout waiting for selector: ${selector}`)),
          options?.timeout ?? 30_000
        );
        (timer as unknown as { unref?: () => void }).unref?.();
      });
    }),
    click: vi.fn((selector: string) => {
      clicked.push(selector);
      return Promise.resolve();
    }),
  } as unknown as Page;
  return { page, clicked };
}

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('DIALOG_SELECTORS', () => {
  it('matches dialog buttons by data-id, never by element id', () => {
    // UCI suffixes ids with a dialog instance number (confirmButton_1), so an
    // `#confirmButton` selector matches nothing at all.
    for (const kind of Object.values(DialogKind)) {
      const spec = DIALOG_SELECTORS[kind];
      for (const selector of [spec.detect, spec.proceed, spec.abort]) {
        expect(selector).toContain('data-id=');
        expect(selector).not.toMatch(/#(confirm|cancel)Button\b/);
      }
    }
  });

  it('scopes the unsaved-changes dialog so generic confirm dialogs cannot match', () => {
    // Delete and deactivate prompts share data-id="confirmdialog" and the same
    // confirmButton/cancelButton pair. Without scoping, the default `proceed`
    // policy would auto-confirm a destructive dialog nobody opted into.
    const spec = DIALOG_SELECTORS[DialogKind.UnsavedChanges];
    expect(spec.detect).toContain('Unsaved changes');
    expect(spec.detect).toContain('[data-uci-dialog="true"]');
  });

  it('leaves the page when proceeding past unsaved changes, and stays when aborting', () => {
    const spec = DIALOG_SELECTORS[DialogKind.UnsavedChanges];
    // "Discard changes" — continues the navigation without saving.
    expect(spec.proceed).toContain('button[data-id="cancelButton"]');
    // The close icon dismisses the prompt and keeps us on the page.
    expect(spec.abort).toContain('button[data-id="dialogCloseIconButton"]');
  });

  it('watches for each dialog using the selector it will later click', () => {
    // The detection selector must be one of the buttons we act on, or we could
    // detect a dialog we have no way to dismiss.
    for (const kind of Object.values(DialogKind)) {
      const spec = DIALOG_SELECTORS[kind];
      expect([spec.proceed, spec.abort]).toContain(spec.detect);
    }
  });
});

describe('DialogHandler.run', () => {
  it('returns the action result untouched when no dialog appears', async () => {
    const { page, clicked } = createPageStub();

    const result = await new DialogHandler(page).run(async () => 'saved-record-id');

    expect(result).toBe('saved-record-id');
    expect(clicked).toEqual([]);
  });

  it('dismisses a duplicate-detection dialog and lets the action finish', async () => {
    const { page, clicked } = createPageStub(['button[data-id="ignore_save"]']);
    const action = deferred<string>();

    const run = new DialogHandler(page).run(() => action.promise, {
      [DialogKind.DuplicateDetection]: 'proceed',
    });

    // The dialog blocks the save until it is dismissed.
    await vi.waitFor(() => expect(clicked).toContain('button[data-id="ignore_save"]'));
    action.resolve('saved-record-id');

    await expect(run).resolves.toBe('saved-record-id');
  });

  it('aborts on duplicates by default, naming the dialog in the error', async () => {
    const { page, clicked } = createPageStub(['button[data-id="ignore_save"]']);

    const run = new DialogHandler(page).run(() => deferred<string>().promise);

    await expect(run).rejects.toBeInstanceOf(DuplicateRecordsFoundError);
    await expect(run).rejects.toThrow(/duplicate/i);
    expect(clicked).toContain('button[data-id="close_dialog"]');
  });

  it('discards changes by default so the navigation completes', async () => {
    const unsaved = DIALOG_SELECTORS[DialogKind.UnsavedChanges];
    const { page, clicked } = createPageStub([unsaved.detect]);
    const action = deferred<void>();

    const run = new DialogHandler(page).run(() => action.promise);

    await vi.waitFor(() => expect(clicked).toContain(unsaved.proceed));
    action.resolve();

    await expect(run).resolves.toBeUndefined();
    // Staying on the page would leave the navigation permanently unresolved.
    expect(clicked).not.toContain(unsaved.abort);
  });

  it('can be told to abort on unsaved changes, staying on the page', async () => {
    const unsaved = DIALOG_SELECTORS[DialogKind.UnsavedChanges];
    const { page, clicked } = createPageStub([unsaved.detect]);

    const run = new DialogHandler(page).run(() => deferred<void>().promise, {
      [DialogKind.UnsavedChanges]: 'abort',
    });

    await expect(run).rejects.toThrow(/unsaved-changes/);
    expect(clicked).toContain(unsaved.abort);
    expect(clicked).not.toContain(unsaved.proceed);
  });

  it('does not wait for a dialog that will never come before returning', async () => {
    const { page } = createPageStub();

    // A 10ms action must not be held up by the 60s dialog watchers.
    const result = await new DialogHandler(page, { timeout: 60_000 }).run(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('done'), 10))
    );

    expect(result).toBe('done');
  });
});

describe('DialogHandler.dismissIfPresent', () => {
  it('reports false when the dialog is not on screen', async () => {
    const { page } = createPageStub();

    const dismissed = await new DialogHandler(page, { timeout: 20 }).dismissIfPresent(
      DialogKind.DuplicateDetection
    );

    expect(dismissed).toBe(false);
  });

  it('clicks the proceed button and reports true when it is', async () => {
    const { page, clicked } = createPageStub(['button[data-id="ignore_save"]']);

    const dismissed = await new DialogHandler(page).dismissIfPresent(DialogKind.DuplicateDetection);

    expect(dismissed).toBe(true);
    expect(clicked).toEqual(['button[data-id="ignore_save"]']);
  });
});
