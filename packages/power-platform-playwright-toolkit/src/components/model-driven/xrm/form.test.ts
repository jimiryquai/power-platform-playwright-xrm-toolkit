import { describe, it, expect, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { XrmHelper } from '../../../core/xrm-helper';
import { RethrownError } from '../../../core/rethrown-error';
import { Form } from './form';

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

function fakeFormItem(id: string, label: string, overrides: Record<string, unknown> = {}) {
  return { getId: () => id, getLabel: () => label, navigate: vi.fn(), ...overrides };
}

describe('Form.getCurrentFormSelectorItem', () => {
  it('returns the current form’s id and label', async () => {
    const xrm = {
      Page: { ui: { formSelector: { getCurrentItem: () => fakeFormItem('form-1', 'Order') } } },
    };
    const page = createPageStub(xrm);

    expect(await new Form(new XrmHelper(page)).getCurrentFormSelectorItem()).toEqual({
      id: 'form-1',
      label: 'Order',
    });
  });
});

describe('Form.getAvailableFormSelectorItems', () => {
  it('returns every available form’s id and label', async () => {
    const items = [fakeFormItem('form-1', 'Order'), fakeFormItem('form-2', 'Order — Extended')];
    const xrm = { Page: { ui: { formSelector: { items: { get: () => items } } } } };
    const page = createPageStub(xrm);

    expect(await new Form(new XrmHelper(page)).getAvailableFormSelectorItems()).toEqual([
      { id: 'form-1', label: 'Order' },
      { id: 'form-2', label: 'Order — Extended' },
    ]);
  });
});

describe('Form.switch', () => {
  it('navigates to the form matched by id', async () => {
    const target = fakeFormItem('form-2', 'Order — Extended');
    const xrm = {
      Page: { ui: { formSelector: { items: { get: (id?: string) => (id ? target : [target]) } } } },
    };
    const page = createPageStub(xrm);

    await new Form(new XrmHelper(page)).switch({ byId: 'form-2' });

    expect(target.navigate).toHaveBeenCalled();
  });

  it('navigates to the form matched by label when switching by name', async () => {
    const other = fakeFormItem('form-1', 'Order');
    const target = fakeFormItem('form-2', 'Order — Extended');
    const xrm = {
      Page: { ui: { formSelector: { items: { get: () => [other, target] } } } },
    };
    const page = createPageStub(xrm);

    await new Form(new XrmHelper(page)).switch({ byName: 'Order — Extended' });

    expect(target.navigate).toHaveBeenCalled();
    expect(other.navigate).not.toHaveBeenCalled();
  });

  it('wraps a form not found by id in a RethrownError naming it', async () => {
    const xrm = { Page: { ui: { formSelector: { items: { get: () => undefined } } } } };
    const page = createPageStub(xrm);

    const call = new Form(new XrmHelper(page)).switch({ byId: 'missing-form' });

    await expect(call).rejects.toBeInstanceOf(RethrownError);
    await expect(call).rejects.toThrow(/missing-form/);
  });

  it('wraps a form not found by name in a RethrownError naming it', async () => {
    const xrm = { Page: { ui: { formSelector: { items: { get: () => [] } } } } };
    const page = createPageStub(xrm);

    const call = new Form(new XrmHelper(page)).switch({ byName: 'Nonexistent' });

    await expect(call).rejects.toBeInstanceOf(RethrownError);
    await expect(call).rejects.toThrow(/Nonexistent/);
  });

  it('rejects when neither byId nor byName is given', async () => {
    const xrm = { Page: { ui: { formSelector: {} } } };
    const page = createPageStub(xrm);

    await expect(new Form(new XrmHelper(page)).switch({})).rejects.toBeInstanceOf(RethrownError);
  });
});
