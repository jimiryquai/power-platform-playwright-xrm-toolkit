import { describe, it, expect, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { executeInFormContext } from './form.context';

/**
 * Page stub whose `evaluate` mimics Playwright faithfully for this bug: the
 * page function is executed with *only* the value passed through
 * `page.evaluate`'s arg slot available — anything else the caller's function
 * closed over in Node is simply not there, exactly as it would not be after
 * crossing a real `new Function(fnString)` boundary in the browser.
 */
function createPageStub(xrm: unknown): Page {
  return {
    evaluate: vi.fn((fn: (arg: unknown) => unknown, arg?: unknown) => {
      const original = (globalThis as { window?: unknown }).window;
      (globalThis as { window?: unknown }).window = { Xrm: xrm };
      try {
        return Promise.resolve(fn(arg));
      } finally {
        (globalThis as { window?: unknown }).window = original;
      }
    }),
  } as unknown as Page;
}

describe('executeInFormContext', () => {
  it('runs the callback with access to Xrm', async () => {
    const xrm = { Utility: { getGlobalContext: () => ({ userSettings: { userName: 'a user' } }) } };
    const page = createPageStub(xrm);

    const result = await executeInFormContext(
      page,
      (Xrm) => Xrm.Utility.getGlobalContext().userSettings.userName
    );

    expect(result).toBe('a user');
  });

  it('delivers a value the caller passes via arg — the fix this test guards', async () => {
    const xrm = { Page: { ui: { setFormNotification: vi.fn() } } };
    const page = createPageStub(xrm);
    const message = 'Record updated';

    // Before the fix, `message` here would cross into the browser as source
    // text via fn.toString() and then be discarded on reconstruction — this
    // callback would see `message` as undefined, not the closed-over value.
    await executeInFormContext(
      page,
      (Xrm, msg: string) => {
        Xrm.Page.ui.setFormNotification(msg, 'INFO', 'test');
      },
      message
    );

    expect(xrm.Page.ui.setFormNotification).toHaveBeenCalledWith(message, 'INFO', 'test');
  });

  it('does not resurrect a Node-side closure once the function crosses into the browser', async () => {
    const xrm = {};
    const page = createPageStub(xrm);
    const outerValue = 'only exists in this test function';

    // This callback references `outerValue` by closure, the anti-pattern
    // executeInFormContext's docs now warn against. Reconstructing the
    // function from a string drops that closure — the callback must see it
    // as undefined, not the real value, proving arg is the only safe channel.
    const result = await executeInFormContext(page, () => {
      return typeof outerValue === 'undefined' ? 'lost' : 'somehow kept';
    });

    expect(result).toBe('lost');
  });

  it('wraps the call so a missing Xrm object throws a clear error', async () => {
    const page = createPageStub(undefined);

    await expect(executeInFormContext(page, (Xrm) => Xrm.Page)).rejects.toThrow(
      'Xrm object not available'
    );
  });
});
