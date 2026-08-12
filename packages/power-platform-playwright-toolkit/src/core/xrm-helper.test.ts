import { describe, it, expect, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { XrmHelper, XRM_HELPER_DEFAULTS } from './xrm-helper';

interface RecordedCall {
  pageFunction: (arg: unknown) => unknown;
  arg: unknown;
  options: { timeout?: number; polling?: number | string } | undefined;
}

/**
 * A Page stub that records how waitForFunction was called.
 *
 * Argument *position* is the whole point: Playwright's signature is
 * waitForFunction(pageFunction, arg, options), and passing `{ timeout }` in the
 * arg slot silently falls back to the page default — CLAUDE.md § 1. Recording
 * all three slots lets us assert the timeout actually lands in options.
 */
function createPageStub(): { page: Page; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const page = {
    waitForFunction: vi.fn(
      (pageFunction: (arg: unknown) => unknown, arg: unknown, options: RecordedCall['options']) => {
        calls.push({ pageFunction, arg, options });
        return Promise.resolve();
      }
    ),
  } as unknown as Page;
  return { page, calls };
}

describe('XrmHelper configuration', () => {
  it('defaults to a 60s timeout and a 2s settle time', () => {
    const { page } = createPageStub();

    const helper = new XrmHelper(page);

    expect(helper.settings.timeout).toBe(60_000);
    expect(helper.settings.settleTime).toBe(2_000);
    expect(helper.settings.debugMode).toBe(false);
  });

  it('exposes those defaults for callers that need to reference them', () => {
    expect(XRM_HELPER_DEFAULTS).toEqual({ timeout: 60_000, settleTime: 2_000, debugMode: false });
  });

  it('merges partial settings over the defaults rather than replacing them', () => {
    const { page } = createPageStub();

    const helper = new XrmHelper(page, { settleTime: 500 });

    expect(helper.settings.settleTime).toBe(500);
    expect(helper.settings.timeout).toBe(60_000);
  });
});

describe('XrmHelper.waitForXrmReady', () => {
  it('passes the timeout as options, not as the page-function argument', async () => {
    const { page, calls } = createPageStub();

    await new XrmHelper(page, { timeout: 12_345 }).waitForXrmReady();

    expect(calls).toHaveLength(1);
    // The regression this guards: `{ timeout }` in the arg slot is accepted
    // silently and the configured timeout is then ignored.
    expect(calls[0].options).toEqual({ timeout: 12_345 });
    expect(calls[0].arg).toBeUndefined();
  });

  it('resolves only once Xrm.Page exists', async () => {
    const { page, calls } = createPageStub();
    await new XrmHelper(page).waitForXrmReady();
    const predicate = calls[0].pageFunction;

    const originalWindow = globalThis.window;
    try {
      (globalThis as { window?: unknown }).window = {};
      expect(predicate(undefined)).toBeFalsy();

      (globalThis as { window?: unknown }).window = { Xrm: {} };
      expect(predicate(undefined)).toBeFalsy();

      (globalThis as { window?: unknown }).window = { Xrm: { Page: {} } };
      expect(predicate(undefined)).toBeTruthy();
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });
});

describe('XrmHelper.waitForIdleness', () => {
  it('sends the settle time as the argument and the timeout as options', async () => {
    const { page, calls } = createPageStub();

    await new XrmHelper(page, { timeout: 9_000, settleTime: 750 }).waitForIdleness();

    expect((calls[0].arg as { settleMs: number }).settleMs).toBe(750);
    expect(calls[0].options?.timeout).toBe(9_000);
    expect(calls[0].options?.polling).toBe(250);
  });

  it('lets a caller override the settle time per call', async () => {
    const { page, calls } = createPageStub();

    await new XrmHelper(page, { settleTime: 2_000 }).waitForIdleness(100);

    expect((calls[0].arg as { settleMs: number }).settleMs).toBe(100);
  });

  it('tags each call with a distinct streak token', async () => {
    const { page, calls } = createPageStub();
    const helper = new XrmHelper(page);

    await helper.waitForIdleness();
    await helper.waitForIdleness();

    const first = (calls[0].arg as { token: string }).token;
    const second = (calls[1].arg as { token: string }).token;
    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it('treats a page with no UCWorkBlockTracker as already idle', async () => {
    const { page, calls } = createPageStub();
    await new XrmHelper(page).waitForIdleness();
    const predicate = calls[0].pageFunction;

    const originalWindow = globalThis.window;
    try {
      (globalThis as { window?: unknown }).window = {};
      expect(predicate({ settleMs: 2_000, token: 't1' })).toBe(true);
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it('requires the app to stay idle for the full settle time', async () => {
    const { page, calls } = createPageStub();
    await new XrmHelper(page).waitForIdleness();
    const predicate = calls[0].pageFunction;
    const arg = { settleMs: 2_000, token: 'streak-1' };

    const originalWindow = globalThis.window;
    const originalNow = Date.now;
    try {
      let idle = true;
      let now = 1_000_000;
      Date.now = () => now;
      (globalThis as { window?: unknown }).window = {
        UCWorkBlockTracker: { isAppIdle: () => idle },
      };

      // First idle observation starts the clock, it is not enough on its own.
      expect(predicate(arg)).toBe(false);

      // Still short of the settle window.
      now += 1_500;
      expect(predicate(arg)).toBe(false);

      // A burst of work resets the clock...
      idle = false;
      expect(predicate(arg)).toBe(false);

      // ...so the previous 1.5s no longer counts toward the settle window.
      idle = true;
      now += 1_000;
      expect(predicate(arg)).toBe(false);

      now += 2_000;
      expect(predicate(arg)).toBe(true);
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
      Date.now = originalNow;
    }
  });

  it('ignores an idle streak left behind by an earlier, timed-out call', async () => {
    const { page, calls } = createPageStub();
    await new XrmHelper(page).waitForIdleness();
    const predicate = calls[0].pageFunction;

    const originalWindow = globalThis.window;
    const originalNow = Date.now;
    try {
      let now = 1_000_000;
      Date.now = () => now;
      (globalThis as { window?: unknown }).window = {
        UCWorkBlockTracker: { isAppIdle: () => true },
      };

      // A previous call starts a streak and then times out, leaving it behind.
      expect(predicate({ settleMs: 2_000, token: 'call-1' })).toBe(false);
      now += 10 * 60 * 1000; // ten minutes pass

      // A new call must start its own streak rather than inheriting that one,
      // which would otherwise look instantly settled.
      expect(predicate({ settleMs: 2_000, token: 'call-2' })).toBe(false);

      now += 2_000;
      expect(predicate({ settleMs: 2_000, token: 'call-2' })).toBe(true);
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
      Date.now = originalNow;
    }
  });
});

describe('XrmHelper.waitForFormReady', () => {
  it('waits for Xrm and then for idleness', async () => {
    const { page, calls } = createPageStub();

    await new XrmHelper(page).waitForFormReady();

    expect(calls).toHaveLength(2);
    expect(calls[0].arg).toBeUndefined(); // waitForXrmReady
    expect((calls[1].arg as { settleMs: number }).settleMs).toBe(2_000); // waitForIdleness
  });
});
