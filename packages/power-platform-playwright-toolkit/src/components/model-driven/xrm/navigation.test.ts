import { describe, it, expect, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { XrmHelper } from '../../../core/xrm-helper';
import { RethrownError } from '../../../core/rethrown-error';
import { DialogHandler, DIALOG_SELECTORS, DialogKind } from '../../../core/dialog-handler';
import { Navigation } from './navigation';

/**
 * Page stub combining what XrmHelper, Navigation's own evaluate calls, and a
 * real DialogHandler all need — mirrors entity.test.ts's stub.
 */
function createPageStub(xrm: unknown, dialogsVisible: string[] = []) {
  const clicked: string[] = [];
  const goto = vi.fn(() => Promise.resolve());
  const page = {
    waitForFunction: vi.fn(() => Promise.resolve()),
    goto,
    evaluate: vi.fn((fn: (arg: unknown) => unknown, arg?: unknown) => {
      const original = (globalThis as { window?: unknown }).window;
      (globalThis as { window?: unknown }).window = { Xrm: xrm };
      try {
        return Promise.resolve(fn(arg));
      } finally {
        (globalThis as { window?: unknown }).window = original;
      }
    }),
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
  return { page, clicked, goto };
}

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

function buildInstance(xrm: unknown, dialogsVisible: string[] = []) {
  const { page, clicked, goto } = createPageStub(xrm, dialogsVisible);
  const navigation = new Navigation(new XrmHelper(page), new DialogHandler(page));
  return { navigation, clicked, goto };
}

const unsaved = DIALOG_SELECTORS[DialogKind.UnsavedChanges];

describe('Navigation.openCreateForm', () => {
  it('opens the form when no dialog interrupts', async () => {
    const openForm = vi.fn(() => Promise.resolve());
    const xrm = { Navigation: { openForm } };
    const { navigation } = buildInstance(xrm);

    await navigation.openCreateForm('nwind_orders');

    expect(openForm).toHaveBeenCalledWith({ entityName: 'nwind_orders', formId: undefined });
  });

  it('discards unsaved changes and completes navigation by default (not the old hang-on-cancel behaviour)', async () => {
    const openFormCompletes = deferred<void>();
    const openForm = vi.fn(() => openFormCompletes.promise);
    const xrm = { Navigation: { openForm } };
    const { navigation, clicked } = buildInstance(xrm, [unsaved.detect]);

    const call = navigation.openCreateForm('nwind_orders');

    await vi.waitFor(() => expect(clicked).toContain(unsaved.proceed));
    openFormCompletes.resolve();

    await expect(call).resolves.toBeUndefined();
    expect(clicked).not.toContain(unsaved.abort);
  });

  it('aborts the navigation when onUnsavedChanges is set to abort', async () => {
    const openForm = vi.fn(() => new Promise<void>(() => undefined));
    const xrm = { Navigation: { openForm } };
    const { navigation, clicked } = buildInstance(xrm, [unsaved.detect]);

    const call = navigation.openCreateForm('nwind_orders', { onUnsavedChanges: 'abort' });

    await expect(call).rejects.toBeInstanceOf(RethrownError);
    expect(clicked).toContain(unsaved.abort);
    expect(clicked).not.toContain(unsaved.proceed);
  });

  it('passes a specific formId through when given', async () => {
    const openForm = vi.fn(() => Promise.resolve());
    const xrm = { Navigation: { openForm } };
    const { navigation } = buildInstance(xrm);

    await navigation.openCreateForm('nwind_orders', { formId: 'form-guid' });

    expect(openForm).toHaveBeenCalledWith({ entityName: 'nwind_orders', formId: 'form-guid' });
  });
});

describe('Navigation.openUpdateForm', () => {
  it('opens the update form for the given record', async () => {
    const openForm = vi.fn(() => Promise.resolve());
    const xrm = { Navigation: { openForm } };
    const { navigation } = buildInstance(xrm);

    await navigation.openUpdateForm('nwind_orders', 'record-guid');

    expect(openForm).toHaveBeenCalledWith({
      entityName: 'nwind_orders',
      entityId: 'record-guid',
      formId: undefined,
    });
  });

  it('wraps a failure in a RethrownError naming the entity and record', async () => {
    const openForm = vi.fn(() => {
      throw new Error('boom');
    });
    const xrm = { Navigation: { openForm } };
    const { navigation } = buildInstance(xrm);

    const call = navigation.openUpdateForm('nwind_orders', 'record-guid');

    await expect(call).rejects.toBeInstanceOf(RethrownError);
    await expect(call).rejects.toThrow(/nwind_orders/);
    await expect(call).rejects.toThrow(/record-guid/);
  });
});

describe('Navigation.openQuickCreate', () => {
  it('opens a quick-create form for the entity', async () => {
    const openForm = vi.fn(() => Promise.resolve());
    const xrm = { Navigation: { openForm } };
    const { navigation } = buildInstance(xrm);

    await navigation.openQuickCreate('nwind_orders');

    expect(openForm).toHaveBeenCalledWith({
      entityName: 'nwind_orders',
      useQuickCreateForm: true,
    });
  });
});

describe('Navigation.navigateTo', () => {
  it('forwards the page input and navigation options to Xrm.Navigation.navigateTo', async () => {
    const navigateTo = vi.fn(() => Promise.resolve());
    const xrm = { Navigation: { navigateTo } };
    const { navigation } = buildInstance(xrm);
    const pageInput = { pageType: 'entityrecord', entityName: 'nwind_orders' };
    const options = { target: 2 };

    await navigation.navigateTo(pageInput, options);

    expect(navigateTo).toHaveBeenCalledWith(pageInput, options);
  });
});

describe('Navigation.openAppById', () => {
  it('navigates the page to the app URL with the appid query param appended', async () => {
    const xrm = {};
    const { navigation, goto } = buildInstance(xrm);

    await navigation.openAppById('app-guid', 'https://org.crm.dynamics.com/main.aspx');

    expect(goto).toHaveBeenCalledWith(
      'https://org.crm.dynamics.com/main.aspx?appid=app-guid',
      expect.objectContaining({ waitUntil: 'load' })
    );
  });

  it('uses & instead of ? when the app URL already has a query string', async () => {
    const xrm = {};
    const { navigation, goto } = buildInstance(xrm);

    await navigation.openAppById('app-guid', 'https://org.crm.dynamics.com/main.aspx?foo=bar');

    expect(goto).toHaveBeenCalledWith(
      'https://org.crm.dynamics.com/main.aspx?foo=bar&appid=app-guid',
      expect.objectContaining({ waitUntil: 'load' })
    );
  });
});
