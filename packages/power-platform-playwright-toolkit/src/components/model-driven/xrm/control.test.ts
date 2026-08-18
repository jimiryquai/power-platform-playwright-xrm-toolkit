import { describe, it, expect, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { XrmHelper } from '../../../core/xrm-helper';
import { RethrownError } from '../../../core/rethrown-error';
import { Control } from './control';

/**
 * Page stub whose `evaluate` runs the callback against a controlled
 * `window.Xrm`, exercising the real evaluate-callback logic.
 */
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

function fakeControl(overrides: Record<string, unknown> = {}) {
  return {
    getVisible: () => true,
    getDisabled: () => false,
    getParent: () => null,
    getOptions: () => [{ text: 'Active', value: 1 }],
    getLabel: () => 'Order Number',
    setVisible: vi.fn(),
    setDisabled: vi.fn(),
    setLabel: vi.fn(),
    ...overrides,
  };
}

describe('Control.get', () => {
  it('reports visible/enabled when the control and its ancestors are visible', async () => {
    const xrm = { Page: { getControl: () => fakeControl() } };
    const page = createPageStub(xrm);

    const state = await new Control(new XrmHelper(page)).get('nwind_ordernumber');

    expect(state).toEqual({ isVisible: true, isDisabled: false });
  });

  it('reports not visible when a parent section/tab is hidden, even if the control itself is', async () => {
    const parent = { getVisible: () => false, getParent: () => null };
    const xrm = { Page: { getControl: () => fakeControl({ getParent: () => parent }) } };
    const page = createPageStub(xrm);

    const state = await new Control(new XrmHelper(page)).get('nwind_ordernumber');

    expect(state.isVisible).toBe(false);
  });

  it('wraps a missing control in a RethrownError naming it', async () => {
    const xrm = { Page: { getControl: () => undefined } };
    const page = createPageStub(xrm);

    const call = new Control(new XrmHelper(page)).get('missing');

    await expect(call).rejects.toBeInstanceOf(RethrownError);
    await expect(call).rejects.toThrow(/missing/);
  });
});

describe('Control.getOptions / setVisible / setDisabled / getLabel / setLabel', () => {
  it('getOptions returns the control options', async () => {
    const xrm = { Page: { getControl: () => fakeControl() } };
    const page = createPageStub(xrm);

    expect(await new Control(new XrmHelper(page)).getOptions('statuscode')).toEqual([
      { text: 'Active', value: 1 },
    ]);
  });

  it('setVisible forwards the visibility flag', async () => {
    const control = fakeControl();
    const xrm = { Page: { getControl: () => control } };
    const page = createPageStub(xrm);

    await new Control(new XrmHelper(page)).setVisible('nwind_ordernumber', false);

    expect(control.setVisible).toHaveBeenCalledWith(false);
  });

  it('setDisabled forwards the disabled flag', async () => {
    const control = fakeControl();
    const xrm = { Page: { getControl: () => control } };
    const page = createPageStub(xrm);

    await new Control(new XrmHelper(page)).setDisabled('nwind_ordernumber', true);

    expect(control.setDisabled).toHaveBeenCalledWith(true);
  });

  it('getLabel returns the control label', async () => {
    const xrm = { Page: { getControl: () => fakeControl() } };
    const page = createPageStub(xrm);

    expect(await new Control(new XrmHelper(page)).getLabel('nwind_ordernumber')).toBe(
      'Order Number'
    );
  });

  it('setLabel forwards the new label text', async () => {
    const control = fakeControl();
    const xrm = { Page: { getControl: () => control } };
    const page = createPageStub(xrm);

    await new Control(new XrmHelper(page)).setLabel('nwind_ordernumber', 'Order #');

    expect(control.setLabel).toHaveBeenCalledWith('Order #');
  });

  it('wraps evaluate failures from any method in a RethrownError', async () => {
    const xrm = { Page: { getControl: () => undefined } };
    const page = createPageStub(xrm);
    const control = new Control(new XrmHelper(page));

    await expect(control.getOptions('missing')).rejects.toBeInstanceOf(RethrownError);
    await expect(control.setVisible('missing', true)).rejects.toBeInstanceOf(RethrownError);
    await expect(control.setDisabled('missing', true)).rejects.toBeInstanceOf(RethrownError);
    await expect(control.getLabel('missing')).rejects.toBeInstanceOf(RethrownError);
    await expect(control.setLabel('missing', 'x')).rejects.toBeInstanceOf(RethrownError);
  });
});
