import { describe, it, expect } from 'vitest';
import type { Page } from '@playwright/test';
import { RethrownError } from '../../core/rethrown-error';
import { DialogHandler } from '../../core/dialog-handler';
import { Sidebar } from './sidebar.component';

// `navigate()`'s happy-path click/dialog-race behaviour (and expandMenu/
// collapseMenu's postconditions) are not unit-tested here: they go through
// Playwright's own `expect(locator).toBeEnabled()`/`toHaveAttribute()`
// web-first assertions, which only accept a genuine Locator instance — a
// plain fake object throws `"toBeEnabled can be only used with Locator
// object"` before the method under test even runs. That behaviour is
// covered by e2e tests against a real page instead. What *is* unit-tested
// here is the failure path, which throws before reaching those assertions.

describe('Sidebar.navigate', () => {
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
