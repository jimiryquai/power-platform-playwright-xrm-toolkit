import { describe, it, expect, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { XrmHelper } from '../../../core/xrm-helper';
import { RethrownError } from '../../../core/rethrown-error';
import { Section } from './section';

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

function fakeSection(overrides: Record<string, unknown> = {}) {
  return { getVisible: () => true, setVisible: vi.fn(), ...overrides };
}

function fakeTab(
  section: ReturnType<typeof fakeSection> | undefined,
  overrides: Record<string, unknown> = {}
) {
  return {
    getVisible: () => true,
    sections: { get: () => section },
    ...overrides,
  };
}

describe('Section.get', () => {
  it('reports visible when both the section and its parent tab are visible', async () => {
    const xrm = { Page: { ui: { tabs: { get: () => fakeTab(fakeSection()) } } } };
    const page = createPageStub(xrm);

    expect(await new Section(new XrmHelper(page)).get('SUMMARY_TAB', 'ACCOUNT_INFO')).toEqual({
      isVisible: true,
    });
  });

  it('reports not visible when the parent tab is hidden even if the section itself is', async () => {
    const xrm = {
      Page: { ui: { tabs: { get: () => fakeTab(fakeSection(), { getVisible: () => false }) } } },
    };
    const page = createPageStub(xrm);

    expect(
      (await new Section(new XrmHelper(page)).get('SUMMARY_TAB', 'ACCOUNT_INFO')).isVisible
    ).toBe(false);
  });

  it('wraps a missing tab in a RethrownError naming it', async () => {
    const xrm = { Page: { ui: { tabs: { get: () => undefined } } } };
    const page = createPageStub(xrm);

    const call = new Section(new XrmHelper(page)).get('missing_tab', 'ACCOUNT_INFO');
    await expect(call).rejects.toBeInstanceOf(RethrownError);
    await expect(call).rejects.toThrow(/missing_tab/);
  });

  it('wraps a missing section in a RethrownError naming it', async () => {
    const xrm = { Page: { ui: { tabs: { get: () => fakeTab(undefined) } } } };
    const page = createPageStub(xrm);

    const call = new Section(new XrmHelper(page)).get('SUMMARY_TAB', 'missing_section');
    await expect(call).rejects.toBeInstanceOf(RethrownError);
    await expect(call).rejects.toThrow(/missing_section/);
  });
});

describe('Section.setVisible', () => {
  it('forwards the visibility flag to the section control', async () => {
    const section = fakeSection();
    const xrm = { Page: { ui: { tabs: { get: () => fakeTab(section) } } } };
    const page = createPageStub(xrm);

    await new Section(new XrmHelper(page)).setVisible('SUMMARY_TAB', 'ACCOUNT_INFO', false);

    expect(section.setVisible).toHaveBeenCalledWith(false);
  });

  it('wraps a missing section in a RethrownError instead of silently no-oping', async () => {
    const xrm = { Page: { ui: { tabs: { get: () => fakeTab(undefined) } } } };
    const page = createPageStub(xrm);

    await expect(
      new Section(new XrmHelper(page)).setVisible('SUMMARY_TAB', 'missing', true)
    ).rejects.toBeInstanceOf(RethrownError);
  });
});
