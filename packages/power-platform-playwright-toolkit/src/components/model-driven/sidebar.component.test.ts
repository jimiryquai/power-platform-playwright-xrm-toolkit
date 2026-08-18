import { describe, it, expect, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { RethrownError } from '../../core/rethrown-error';
import { DialogHandler, DIALOG_SELECTORS, DialogKind } from '../../core/dialog-handler';
import { Sidebar } from './sidebar.component';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

/**
 * Fake tree-item locator. `.click()` is recorded so tests can assert whether
 * navigation actually happened; every other call is a no-op returning benign
 * defaults, matching what a visible, unselected sidebar item looks like.
 *
 * `.click()` does not resolve until `clickCompletes` does — like
 * navigation.test.ts's stub, this is required so the dialog watcher in
 * `DialogHandler.run` has a chance to detect a dialog before the action wins
 * the race; an instantly-resolving click can beat the watcher non-deterministically.
 */
function makeTreeItemLocator(
  clicked: string[],
  label: string,
  clickCompletes: Promise<void>
) {
  return {
    waitFor: async () => undefined,
    click: async () => {
      clicked.push(label);
      await clickCompletes;
    },
    getAttribute: async () => null,
  };
}

/**
 * Page stub combining what Sidebar's own locator calls and a real
 * DialogHandler both need — mirrors navigation.test.ts's stub.
 */
function createPageStub(dialogsVisible: string[] = [], clickCompletes: Promise<void> = Promise.resolve()) {
  const clicked: string[] = [];
  const page = {
    locator: (selector: string) => makeTreeItemLocator(clicked, selector, clickCompletes),
    waitForSelector: vi.fn((selector: string, options?: { timeout?: number }) => {
      if (dialogsVisible.includes(selector)) {
        return Promise.resolve({});
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

const unsaved = DIALOG_SELECTORS[DialogKind.UnsavedChanges];

describe('Sidebar.navigate', () => {
  it('clicks the sidebar item when no dialog interrupts', async () => {
    const { page, clicked } = createPageStub();
    const sidebar = new Sidebar(page, new DialogHandler(page));

    await sidebar.navigate('Accounts');

    expect(clicked).toContain('li[role="treeitem"][aria-label="Accounts"]');
  });

  it('discards unsaved changes and completes navigation by default', async () => {
    const click = deferred<void>();
    const { page, clicked } = createPageStub([unsaved.detect], click.promise);
    const sidebar = new Sidebar(page, new DialogHandler(page));

    const call = sidebar.navigate('Accounts');

    await vi.waitFor(() => expect(clicked).toContain(unsaved.proceed));
    click.resolve();

    await expect(call).resolves.toBeUndefined();
    expect(clicked).not.toContain(unsaved.abort);
  });

  it('aborts the navigation when onUnsavedChanges is set to abort', async () => {
    const { page, clicked } = createPageStub([unsaved.detect], new Promise(() => undefined));
    const sidebar = new Sidebar(page, new DialogHandler(page));

    const call = sidebar.navigate('Accounts', { onUnsavedChanges: 'abort' });

    await expect(call).rejects.toBeInstanceOf(RethrownError);
    expect(clicked).toContain(unsaved.abort);
  });

  it('wraps a DOM-action failure in a RethrownError naming the item', async () => {
    const page = {
      locator: () => ({
        waitFor: async () => {
          throw new Error('boom');
        },
      }),
    } as unknown as Page;
    const sidebar = new Sidebar(page, new DialogHandler(page));

    const call = sidebar.navigate('Accounts');

    await expect(call).rejects.toBeInstanceOf(RethrownError);
    await expect(call).rejects.toThrow(/Accounts/);
  });
});

describe('Sidebar.getCurrentSubArea', () => {
  it('reads the active tree item data-text', async () => {
    const page = {
      locator: () => ({
        getAttribute: async (attr: string) => (attr === 'data-text' ? 'Orders' : null),
      }),
    } as unknown as Page;
    const sidebar = new Sidebar(page, new DialogHandler(page));

    await expect(sidebar.getCurrentSubArea()).resolves.toBe('Orders');
  });

  it('wraps a failure in a RethrownError', async () => {
    const page = {
      locator: () => ({
        getAttribute: async () => {
          throw new Error('boom');
        },
      }),
    } as unknown as Page;
    const sidebar = new Sidebar(page, new DialogHandler(page));

    await expect(sidebar.getCurrentSubArea()).rejects.toBeInstanceOf(RethrownError);
  });
});
