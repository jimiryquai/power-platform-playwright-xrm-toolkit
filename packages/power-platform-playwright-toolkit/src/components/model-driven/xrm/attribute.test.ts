import { describe, it, expect, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { XrmHelper } from '../../../core/xrm-helper';
import { RethrownError } from '../../../core/rethrown-error';
import { Attribute } from './attribute';

/**
 * Page stub whose `evaluate` actually runs the callback against a `window.Xrm`
 * we control, so these tests exercise the real evaluate-callback logic rather
 * than just asserting it was called. `waitForFunction` (used by XrmHelper)
 * resolves immediately — XrmHelper's own readiness logic is covered by
 * xrm-helper.test.ts.
 */
function createPageStub(xrm: unknown): { page: Page; evaluateArgs: unknown[] } {
  const evaluateArgs: unknown[] = [];
  const page = {
    waitForFunction: vi.fn(() => Promise.resolve()),
    evaluate: vi.fn((fn: (arg: unknown) => unknown, arg?: unknown) => {
      evaluateArgs.push(arg);
      const original = (globalThis as { window?: unknown }).window;
      (globalThis as { window?: unknown }).window = { Xrm: xrm };
      try {
        return Promise.resolve(fn(arg));
      } finally {
        (globalThis as { window?: unknown }).window = original;
      }
    }),
  } as unknown as Page;
  return { page, evaluateArgs };
}

/** A minimal Xrm attribute stub covering the calls Attribute's methods make. */
function fakeAttribute(overrides: Record<string, unknown> = {}) {
  return {
    getRequiredLevel: () => 'none',
    getValue: () => 'a value',
    getAttributeType: () => 'string',
    getIsDirty: () => false,
    setRequiredLevel: vi.fn(),
    setValue: vi.fn(),
    fireOnChange: vi.fn(),
    controls: { get: () => [editableControl()] },
    ...overrides,
  };
}

function editableControl(overrides: Record<string, unknown> = {}) {
  return {
    getDisabled: () => false,
    getVisible: () => true,
    getParent: () => null,
    ...overrides,
  };
}

describe('Attribute.getRequiredLevel', () => {
  it('returns the required level from the Xrm attribute', async () => {
    const xrm = {
      Page: { getAttribute: () => fakeAttribute({ getRequiredLevel: () => 'required' }) },
    };
    const { page } = createPageStub(xrm);

    const level = await new Attribute(new XrmHelper(page)).getRequiredLevel('nwind_ordernumber');

    expect(level).toBe('required');
  });

  it('wraps a missing attribute in a RethrownError naming the attribute', async () => {
    const xrm = { Page: { getAttribute: () => undefined } };
    const { page } = createPageStub(xrm);

    const call = new Attribute(new XrmHelper(page)).getRequiredLevel('missing_attr');

    await expect(call).rejects.toBeInstanceOf(RethrownError);
    await expect(call).rejects.toThrow(/missing_attr/);
  });
});

describe('Attribute.getValue', () => {
  it('returns the raw value for a non-datetime attribute', async () => {
    const xrm = {
      Page: {
        getAttribute: () =>
          fakeAttribute({ getAttributeType: () => 'string', getValue: () => 'TEST-12345' }),
      },
    };
    const { page } = createPageStub(xrm);

    const value = await new Attribute(new XrmHelper(page)).getValue('nwind_ordernumber');

    expect(value).toBe('TEST-12345');
  });

  it('round-trips a datetime value through a Date instance', async () => {
    const when = new Date('2026-01-15T10:30:00.000Z');
    const xrm = {
      Page: {
        getAttribute: () =>
          fakeAttribute({ getAttributeType: () => 'datetime', getValue: () => when }),
      },
    };
    const { page } = createPageStub(xrm);

    const value = await new Attribute(new XrmHelper(page)).getValue('nwind_orderdate');

    expect(value).toBeInstanceOf(Date);
    expect((value as Date).toISOString()).toBe(when.toISOString());
  });

  it('wraps a missing attribute in a RethrownError', async () => {
    const xrm = { Page: { getAttribute: () => undefined } };
    const { page } = createPageStub(xrm);

    await expect(
      new Attribute(new XrmHelper(page)).getValue('missing_attr')
    ).rejects.toBeInstanceOf(RethrownError);
  });
});

describe('Attribute.setValue', () => {
  it('commits the value to the Xrm model and fires onChange, not just the DOM', async () => {
    const attr = fakeAttribute();
    const xrm = { Page: { getAttribute: () => attr } };
    const { page } = createPageStub(xrm);

    await new Attribute(new XrmHelper(page)).setValue('nwind_ordernumber', 'TEST-12345');

    // CLAUDE.md § 9: D365 saves what the Xrm attribute model knows, not the
    // DOM — setValue() must be called on the attribute itself.
    expect(attr.setValue).toHaveBeenCalledWith('TEST-12345');
    expect(attr.fireOnChange).toHaveBeenCalled();
  });

  it('converts a Date to ISO string crossing into the browser, and back to a Date attribute value', async () => {
    const attr = fakeAttribute({ getAttributeType: () => 'datetime' });
    const xrm = { Page: { getAttribute: () => attr } };
    const { page } = createPageStub(xrm);
    const when = new Date('2026-03-01T00:00:00.000Z');

    await new Attribute(new XrmHelper(page)).setValue('nwind_orderdate', when);

    expect(attr.setValue).toHaveBeenCalledWith(when);
  });

  it('clears a datetime field on null instead of committing the Unix epoch', async () => {
    const attr = fakeAttribute({ getAttributeType: () => 'datetime' });
    const xrm = { Page: { getAttribute: () => attr } };
    const { page } = createPageStub(xrm);

    // new Date(null) is 1970-01-01T00:00:00.000Z — a real date the caller
    // never asked for. Clearing a field must stay null, not become the epoch.
    await new Attribute(new XrmHelper(page)).setValue('nwind_orderdate', null);

    expect(attr.setValue).toHaveBeenCalledWith(null);
  });

  it('refuses to set a value with no unlocked, visible control', async () => {
    const attr = fakeAttribute({
      controls: { get: () => [editableControl({ getDisabled: () => true })] },
    });
    const xrm = { Page: { getAttribute: () => attr } };
    const { page } = createPageStub(xrm);

    const call = new Attribute(new XrmHelper(page)).setValue('nwind_ordernumber', 'x');

    await expect(call).rejects.toBeInstanceOf(RethrownError);
    const rethrown = (await call.catch((e) => e)) as RethrownError;
    expect(rethrown.originalError.message).toMatch(/no unlocked and visible control/);
    expect(attr.setValue).not.toHaveBeenCalled();
  });

  it('sets a locked/hidden field anyway when forceValue is set', async () => {
    const attr = fakeAttribute({
      controls: { get: () => [editableControl({ getDisabled: () => true })] },
    });
    const xrm = { Page: { getAttribute: () => attr } };
    const { page } = createPageStub(xrm);

    await new Attribute(new XrmHelper(page)).setValue('nwind_ordernumber', 'x', {
      forceValue: true,
    });

    expect(attr.setValue).toHaveBeenCalledWith('x');
  });

  it('accepts a bare number as shorthand for settleTime', async () => {
    const attr = fakeAttribute();
    const xrm = { Page: { getAttribute: () => attr } };
    const { page } = createPageStub(xrm);
    const waitForIdleness = vi.spyOn(XrmHelper.prototype, 'waitForIdleness');

    await new Attribute(new XrmHelper(page)).setValue('nwind_ordernumber', 'x', 1234);

    expect(waitForIdleness).toHaveBeenCalledWith(1234);
    waitForIdleness.mockRestore();
  });
});

describe('Attribute.setValues', () => {
  it('sets each attribute in the map', async () => {
    const attrs: Record<string, ReturnType<typeof fakeAttribute>> = {
      nwind_ordernumber: fakeAttribute(),
      nwind_orderamount: fakeAttribute(),
    };
    const xrm = { Page: { getAttribute: (name: string) => attrs[name] } };
    const { page } = createPageStub(xrm);

    await new Attribute(new XrmHelper(page)).setValues({
      nwind_ordernumber: 'TEST-1',
      nwind_orderamount: 42,
    });

    expect(attrs.nwind_ordernumber.setValue).toHaveBeenCalledWith('TEST-1');
    expect(attrs.nwind_orderamount.setValue).toHaveBeenCalledWith(42);
  });
});

describe('Attribute.getAttributeType / getFormattedValue / isDirty / setRequiredLevel', () => {
  it('getAttributeType returns the Xrm attribute type', async () => {
    const xrm = {
      Page: { getAttribute: () => fakeAttribute({ getAttributeType: () => 'optionset' }) },
    };
    const { page } = createPageStub(xrm);

    expect(await new Attribute(new XrmHelper(page)).getAttributeType('statuscode')).toBe(
      'optionset'
    );
  });

  it('getFormattedValue returns the selected option label for an optionset', async () => {
    // getText() is the Xrm Client API's actual display-label accessor for
    // OptionSetAttribute — getFormat() would return a type descriptor like
    // 'optionset', not the label.
    const xrm = {
      Page: { getAttribute: () => fakeAttribute({ getText: () => 'Active' }) },
    };
    const { page } = createPageStub(xrm);

    expect(await new Attribute(new XrmHelper(page)).getFormattedValue('statuscode')).toBe('Active');
  });

  it('getFormattedValue falls back to the stringified raw value for attribute types with no getText()', async () => {
    const xrm = {
      Page: { getAttribute: () => fakeAttribute({ getValue: () => 42 }) },
    };
    const { page } = createPageStub(xrm);

    expect(await new Attribute(new XrmHelper(page)).getFormattedValue('nwind_orderamount')).toBe(
      '42'
    );
  });

  it('getFormattedValue returns an empty string rather than "null"/"undefined" for an empty value', async () => {
    const xrm = {
      Page: { getAttribute: () => fakeAttribute({ getValue: () => null }) },
    };
    const { page } = createPageStub(xrm);

    expect(await new Attribute(new XrmHelper(page)).getFormattedValue('nwind_ordernumber')).toBe(
      ''
    );
  });

  it('isDirty reflects the attribute dirty state', async () => {
    const xrm = { Page: { getAttribute: () => fakeAttribute({ getIsDirty: () => true }) } };
    const { page } = createPageStub(xrm);

    expect(await new Attribute(new XrmHelper(page)).isDirty('nwind_ordernumber')).toBe(true);
  });

  it('setRequiredLevel forwards the level to the Xrm attribute', async () => {
    const attr = fakeAttribute();
    const xrm = { Page: { getAttribute: () => attr } };
    const { page } = createPageStub(xrm);

    await new Attribute(new XrmHelper(page)).setRequiredLevel('nwind_ordernumber', 'required');

    expect(attr.setRequiredLevel).toHaveBeenCalledWith('required');
  });

  it('wraps evaluate failures from any method in a RethrownError', async () => {
    const xrm = { Page: { getAttribute: () => undefined } };
    const { page } = createPageStub(xrm);
    const attribute = new Attribute(new XrmHelper(page));

    await expect(attribute.getAttributeType('missing')).rejects.toBeInstanceOf(RethrownError);
    await expect(attribute.getFormattedValue('missing')).rejects.toBeInstanceOf(RethrownError);
    await expect(attribute.isDirty('missing')).rejects.toBeInstanceOf(RethrownError);
    await expect(attribute.setRequiredLevel('missing', 'none')).rejects.toBeInstanceOf(
      RethrownError
    );
  });
});
