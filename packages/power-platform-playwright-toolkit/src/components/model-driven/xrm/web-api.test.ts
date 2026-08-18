import { describe, it, expect, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { XrmHelper } from '../../../core/xrm-helper';
import { RethrownError } from '../../../core/rethrown-error';
import { WebApi } from './web-api';

/**
 * Page stub whose `evaluate` runs the callback against a controlled
 * `window.Xrm.WebApi`, recording each call's arg so paging calls can be
 * asserted individually.
 */
function createPageStub(webApi: Record<string, unknown>): { page: Page; evaluateArgs: unknown[] } {
  const evaluateArgs: unknown[] = [];
  const page = {
    waitForFunction: vi.fn(() => Promise.resolve()),
    evaluate: vi.fn((fn: (arg: unknown) => unknown, arg?: unknown) => {
      evaluateArgs.push(arg);
      const original = (globalThis as { window?: unknown }).window;
      (globalThis as { window?: unknown }).window = { Xrm: { WebApi: webApi } };
      try {
        return Promise.resolve(fn(arg));
      } finally {
        (globalThis as { window?: unknown }).window = original;
      }
    }),
  } as unknown as Page;
  return { page, evaluateArgs };
}

describe('WebApi.createRecord', () => {
  it('creates a record and returns its id and entityType', async () => {
    const createRecord = vi.fn(() => ({ id: 'guid-1', entityType: 'nwind_orders' }));
    const { page } = createPageStub({ createRecord });

    const result = await new WebApi(new XrmHelper(page)).createRecord('nwind_orders', {
      nwind_ordernumber: 'TEST-1',
    });

    expect(result).toEqual({ id: 'guid-1', entityType: 'nwind_orders' });
    expect(createRecord).toHaveBeenCalledWith('nwind_orders', { nwind_ordernumber: 'TEST-1' });
  });

  it('wraps a failure in a RethrownError naming the entity', async () => {
    const createRecord = vi.fn(() => {
      throw new Error('boom');
    });
    const { page } = createPageStub({ createRecord });

    await expect(
      new WebApi(new XrmHelper(page)).createRecord('nwind_orders', {})
    ).rejects.toBeInstanceOf(RethrownError);
  });
});

describe('WebApi.retrieveRecord', () => {
  it('retrieves a record created via createRecord, by id', async () => {
    const store: Record<string, unknown> = {
      'guid-1': { nwind_ordernumber: 'TEST-1' },
    };
    const retrieveRecord = vi.fn((_entity: string, id: string) => store[id]);
    const { page } = createPageStub({ retrieveRecord });

    const record = await new WebApi(new XrmHelper(page)).retrieveRecord('nwind_orders', 'guid-1');

    expect(record).toEqual({ nwind_ordernumber: 'TEST-1' });
  });

  it('wraps a failure in a RethrownError naming the record id', async () => {
    const retrieveRecord = vi.fn(() => {
      throw new Error('not found');
    });
    const { page } = createPageStub({ retrieveRecord });

    const call = new WebApi(new XrmHelper(page)).retrieveRecord('nwind_orders', 'missing-id');

    await expect(call).rejects.toBeInstanceOf(RethrownError);
    await expect(call).rejects.toThrow(/missing-id/);
  });
});

describe('WebApi.retrieveAllRecords', () => {
  it('returns every entity from a single page with no nextLink', async () => {
    const retrieveMultipleRecords = vi.fn(() => ({ entities: [{ id: '1' }, { id: '2' }] }));
    const { page } = createPageStub({ retrieveMultipleRecords });

    const all = await new WebApi(new XrmHelper(page)).retrieveAllRecords('nwind_orders');

    expect(all).toEqual([{ id: '1' }, { id: '2' }]);
    expect(retrieveMultipleRecords).toHaveBeenCalledTimes(1);
  });

  it('follows @odata.nextLink across pages until it is absent, concatenating every page', async () => {
    const pages = [
      {
        entities: [{ id: '1' }, { id: '2' }],
        '@odata.nextLink': 'https://org.crm.dynamics.com/page2',
      },
      {
        entities: [{ id: '3' }, { id: '4' }],
        '@odata.nextLink': 'https://org.crm.dynamics.com/page3',
      },
      { entities: [{ id: '5' }] }, // final page: no nextLink
    ];
    let call = 0;
    const retrieveMultipleRecords = vi.fn(() => pages[call++]);
    const { page } = createPageStub({ retrieveMultipleRecords });

    const all = await new WebApi(new XrmHelper(page)).retrieveAllRecords(
      'nwind_orders',
      '?$select=name'
    );

    expect(all).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }]);
    expect(retrieveMultipleRecords).toHaveBeenCalledTimes(3);
  });

  it('passes the nextLink as the query options on the following page request', async () => {
    const pages = [
      { entities: [{ id: '1' }], '@odata.nextLink': 'https://org.crm.dynamics.com/page2' },
      { entities: [{ id: '2' }] },
    ];
    let call = 0;
    const retrieveMultipleRecords = vi.fn((_entity: string, queryOptions: string | undefined) => {
      // First call carries the caller's original query; the second must
      // carry the nextLink returned by the first, not the original query.
      if (call === 0) {
        expect(queryOptions).toBe('?$select=name');
      } else {
        expect(queryOptions).toBe('https://org.crm.dynamics.com/page2');
      }
      return pages[call++];
    });
    const { page } = createPageStub({ retrieveMultipleRecords });

    await new WebApi(new XrmHelper(page)).retrieveAllRecords('nwind_orders', '?$select=name');

    expect(retrieveMultipleRecords).toHaveBeenCalledTimes(2);
  });
});

describe('WebApi.updateRecord / deleteRecord', () => {
  it('updates a record with the supplied data', async () => {
    const updateRecord = vi.fn(() => ({ id: 'guid-1', entityType: 'nwind_orders' }));
    const { page } = createPageStub({ updateRecord });

    const result = await new WebApi(new XrmHelper(page)).updateRecord('nwind_orders', 'guid-1', {
      nwind_ordernumber: 'UPDATED',
    });

    expect(result).toEqual({ id: 'guid-1', entityType: 'nwind_orders' });
    expect(updateRecord).toHaveBeenCalledWith('nwind_orders', 'guid-1', {
      nwind_ordernumber: 'UPDATED',
    });
  });

  it('deletes a record by id', async () => {
    const deleteRecord = vi.fn(() => ({}));
    const { page } = createPageStub({ deleteRecord });

    await new WebApi(new XrmHelper(page)).deleteRecord('nwind_orders', 'guid-1');

    expect(deleteRecord).toHaveBeenCalledWith('nwind_orders', 'guid-1');
  });

  it('wraps update/delete failures in a RethrownError', async () => {
    const updateRecord = vi.fn(() => {
      throw new Error('boom');
    });
    const deleteRecord = vi.fn(() => {
      throw new Error('boom');
    });
    const { page } = createPageStub({ updateRecord, deleteRecord });
    const webApi = new WebApi(new XrmHelper(page));

    await expect(webApi.updateRecord('nwind_orders', 'guid-1', {})).rejects.toBeInstanceOf(
      RethrownError
    );
    await expect(webApi.deleteRecord('nwind_orders', 'guid-1')).rejects.toBeInstanceOf(
      RethrownError
    );
  });
});
