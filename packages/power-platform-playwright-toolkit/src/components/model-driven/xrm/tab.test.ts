import { describe, it, expect, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { XrmHelper } from '../../../core/xrm-helper';
import { RethrownError } from '../../../core/rethrown-error';
import { Tab } from './tab';

function createPageStub(xrm: unknown): Page {
  return {
    waitForFunction: vi.fn(() => Promise.resolve()),
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

function fakeTab(name: string, overrides: Record<string, unknown> = {}) {
  return {
    getName: () => name,
    getVisible: () => true,
    setDisplayState: vi.fn(),
    ...overrides,
  };
}

describe('Tab.open / close', () => {
  it('expands the tab by setting display state to expanded', async () => {
    const tab = fakeTab('SUMMARY_TAB');
    const xrm = { Page: { ui: { tabs: { get: () => tab } } } };
    const page = createPageStub(xrm);

    await new Tab(new XrmHelper(page)).open('SUMMARY_TAB');

    expect(tab.setDisplayState).toHaveBeenCalledWith('expanded');
  });

  it('collapses the tab by setting display state to collapsed', async () => {
    const tab = fakeTab('SUMMARY_TAB');
    const xrm = { Page: { ui: { tabs: { get: () => tab } } } };
    const page = createPageStub(xrm);

    await new Tab(new XrmHelper(page)).close('SUMMARY_TAB');

    expect(tab.setDisplayState).toHaveBeenCalledWith('collapsed');
  });

  it('wraps a missing tab in a RethrownError naming it', async () => {
    const xrm = { Page: { ui: { tabs: { get: () => undefined } } } };
    const page = createPageStub(xrm);
    const tabApi = new Tab(new XrmHelper(page));

    await expect(tabApi.open('missing')).rejects.toBeInstanceOf(RethrownError);
    await expect(tabApi.close('missing')).rejects.toThrow(/missing/);
  });
});

describe('Tab.get', () => {
  it('returns the visibility of the named tab', async () => {
    const xrm = {
      Page: { ui: { tabs: { get: () => fakeTab('SUMMARY_TAB', { getVisible: () => false }) } } },
    };
    const page = createPageStub(xrm);

    expect(await new Tab(new XrmHelper(page)).get('SUMMARY_TAB')).toEqual({ isVisible: false });
  });

  it('wraps a missing tab in a RethrownError', async () => {
    const xrm = { Page: { ui: { tabs: { get: () => undefined } } } };
    const page = createPageStub(xrm);

    await expect(new Tab(new XrmHelper(page)).get('missing')).rejects.toBeInstanceOf(RethrownError);
  });
});

describe('Tab.getAll', () => {
  it('returns every tab’s name and visibility', async () => {
    const tabs = [fakeTab('SUMMARY_TAB'), fakeTab('DETAILS_TAB', { getVisible: () => false })];
    const xrm = {
      Page: {
        ui: {
          tabs: {
            forEach: (cb: (t: (typeof tabs)[number]) => void) => tabs.forEach(cb),
          },
        },
      },
    };
    const page = createPageStub(xrm);

    expect(await new Tab(new XrmHelper(page)).getAll()).toEqual([
      { name: 'SUMMARY_TAB', isVisible: true },
      { name: 'DETAILS_TAB', isVisible: false },
    ]);
  });
});
