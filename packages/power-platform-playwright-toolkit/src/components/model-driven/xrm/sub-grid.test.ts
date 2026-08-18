import { describe, it, expect, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { XrmHelper } from '../../../core/xrm-helper';
import { RethrownError } from '../../../core/rethrown-error';
import { SubGrid } from './sub-grid';

function createPageStub(
  xrm: unknown,
  url = 'https://org.crm.dynamics.com/main.aspx?pagetype=entityrecord'
) {
  const goto = vi.fn(() => Promise.resolve());
  const page = {
    waitForFunction: vi.fn(() => Promise.resolve()),
    url: vi.fn(() => url),
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
  } as unknown as Page;
  return { page, goto };
}

function fakeRow(id: string, entityType = 'nwind_orders') {
  return {
    getData: () => ({
      getEntity: () => ({
        getId: () => `{${id}}`,
        getEntityReference: () => ({ id: `{${id}}`, entityType }),
      }),
    }),
  };
}

function fakeGridControl(
  rows: ReturnType<typeof fakeRow>[],
  overrides: Record<string, unknown> = {}
) {
  return {
    getGrid: () => ({
      getTotalRecordCount: () => rows.length,
      getRows: () => ({
        getLength: () => rows.length,
        get: (i: number) => rows[i],
      }),
      refresh: vi.fn(),
    }),
    getEntityName: () => 'nwind_orders',
    getVisible: () => true,
    refresh: vi.fn(),
    ...overrides,
  };
}

describe('SubGrid.getRecordCount / getVisibleRecordCount', () => {
  it('returns the total and visible record counts', async () => {
    const control = fakeGridControl([fakeRow('1'), fakeRow('2'), fakeRow('3')]);
    const xrm = { Page: { getControl: () => control } };
    const { page } = createPageStub(xrm);

    const subGrid = new SubGrid(new XrmHelper(page));
    expect(await subGrid.getRecordCount('Orders_SubGrid')).toBe(3);
    expect(await subGrid.getVisibleRecordCount('Orders_SubGrid')).toBe(3);
  });

  it('returns undefined rather than throwing when the subgrid control is missing', async () => {
    const xrm = { Page: { getControl: () => undefined } };
    const { page } = createPageStub(xrm);

    const subGrid = new SubGrid(new XrmHelper(page));
    expect(await subGrid.getRecordCount('missing')).toBeUndefined();
    expect(await subGrid.getVisibleRecordCount('missing')).toBeUndefined();
  });
});

describe('SubGrid.openNthRecord', () => {
  it('navigates to the nth record’s form URL, carrying appid forward from the current URL', async () => {
    // Dropping appid here isn't cosmetic — D365 session-restore lands on an
    // error page without it (see AppProvider.getModelDrivenAppPage and
    // navigateToGridView/navigateToFormView, which both re-attach it for the
    // same reason).
    const control = fakeGridControl([
      fakeRow('11111111-1111-1111-1111-111111111111'),
      fakeRow('2'),
    ]);
    const xrm = { Page: { getControl: () => control } };
    const { page, goto } = createPageStub(
      xrm,
      'https://org.crm.dynamics.com/main.aspx?pagetype=entityrecord&etn=account&appid=app-guid-123'
    );

    const ref = await new SubGrid(new XrmHelper(page)).openNthRecord('Orders_SubGrid', 0);

    expect(ref).toEqual({
      id: '{11111111-1111-1111-1111-111111111111}',
      entityType: 'nwind_orders',
    });
    expect(goto).toHaveBeenCalledTimes(1);
    const navigatedUrl = new URL((goto.mock.calls[0] as [string])[0]);
    expect(navigatedUrl.origin).toBe('https://org.crm.dynamics.com');
    expect(navigatedUrl.pathname).toBe('/main.aspx');
    expect(navigatedUrl.searchParams.get('etn')).toBe('nwind_orders');
    expect(navigatedUrl.searchParams.get('id')).toBe('{11111111-1111-1111-1111-111111111111}');
    expect(navigatedUrl.searchParams.get('pagetype')).toBe('entityrecord');
    expect(navigatedUrl.searchParams.get('appid')).toBe('app-guid-123');
  });

  it('omits appid rather than inventing one when the current URL has none', async () => {
    const control = fakeGridControl([fakeRow('1')]);
    const xrm = { Page: { getControl: () => control } };
    const { page, goto } = createPageStub(
      xrm,
      'https://org.crm.dynamics.com/main.aspx?pagetype=entityrecord'
    );

    await new SubGrid(new XrmHelper(page)).openNthRecord('Orders_SubGrid', 0);

    const navigatedUrl = new URL((goto.mock.calls[0] as [string])[0]);
    expect(navigatedUrl.searchParams.has('appid')).toBe(false);
  });

  it('wraps an out-of-range index in a RethrownError instead of navigating', async () => {
    const control = fakeGridControl([fakeRow('1')]);
    const xrm = { Page: { getControl: () => control } };
    const { page, goto } = createPageStub(xrm);

    const call = new SubGrid(new XrmHelper(page)).openNthRecord('Orders_SubGrid', 5);

    await expect(call).rejects.toBeInstanceOf(RethrownError);
    const rethrown = (await call.catch((e) => e)) as RethrownError;
    expect(rethrown.originalError.message).toMatch(/out of range/);
    expect(goto).not.toHaveBeenCalled();
  });

  it('wraps a missing subgrid control in a RethrownError', async () => {
    const xrm = { Page: { getControl: () => undefined } };
    const { page } = createPageStub(xrm);

    await expect(
      new SubGrid(new XrmHelper(page)).openNthRecord('missing', 0)
    ).rejects.toBeInstanceOf(RethrownError);
  });
});

describe('SubGrid.getEntityName / refresh / getRecordIds / isVisible', () => {
  it('getEntityName returns the displayed entity, undefined if missing', async () => {
    const control = fakeGridControl([]);
    const xrmFound = { Page: { getControl: () => control } };
    const xrmMissing = { Page: { getControl: () => undefined } };

    expect(
      await new SubGrid(new XrmHelper(createPageStub(xrmFound).page)).getEntityName('sg')
    ).toBe('nwind_orders');
    expect(
      await new SubGrid(new XrmHelper(createPageStub(xrmMissing).page)).getEntityName('sg')
    ).toBeUndefined();
  });

  it('refresh calls the grid control’s refresh', async () => {
    const control = fakeGridControl([]);
    const xrm = { Page: { getControl: () => control } };
    const { page } = createPageStub(xrm);

    await new SubGrid(new XrmHelper(page)).refresh('Orders_SubGrid');

    expect(control.refresh).toHaveBeenCalled();
  });

  it('getRecordIds normalizes ids to lower-case, no braces', async () => {
    const control = fakeGridControl([fakeRow('AAAAAAAA-1111-1111-1111-111111111111')]);
    const xrm = { Page: { getControl: () => control } };
    const { page } = createPageStub(xrm);

    expect(await new SubGrid(new XrmHelper(page)).getRecordIds('Orders_SubGrid')).toEqual([
      'aaaaaaaa-1111-1111-1111-111111111111',
    ]);
  });

  it('getRecordIds returns an empty array rather than throwing when the subgrid is missing', async () => {
    const xrm = { Page: { getControl: () => undefined } };
    const { page } = createPageStub(xrm);

    expect(await new SubGrid(new XrmHelper(page)).getRecordIds('missing')).toEqual([]);
  });

  it('isVisible reflects the control visibility, false if missing', async () => {
    const control = fakeGridControl([], { getVisible: () => false });
    const xrm = { Page: { getControl: () => control } };
    const { page } = createPageStub(xrm);

    expect(await new SubGrid(new XrmHelper(page)).isVisible('Orders_SubGrid')).toBe(false);

    const xrmMissing = { Page: { getControl: () => undefined } };
    expect(
      await new SubGrid(new XrmHelper(createPageStub(xrmMissing).page)).isVisible('missing')
    ).toBe(false);
  });

  it('wraps a refresh failure in a RethrownError', async () => {
    const xrm = { Page: { getControl: () => undefined } };
    const { page } = createPageStub(xrm);

    await expect(new SubGrid(new XrmHelper(page)).refresh('missing')).rejects.toBeInstanceOf(
      RethrownError
    );
  });
});
