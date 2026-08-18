import { describe, it, expect, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { XrmHelper } from '../../../core/xrm-helper';
import { RethrownError } from '../../../core/rethrown-error';
import {
  DialogHandler,
  DIALOG_SELECTORS,
  DialogKind,
  DuplicateRecordsFoundError,
} from '../../../core/dialog-handler';
import { Entity } from './entity';

/**
 * Page stub combining what XrmHelper, the Entity's own evaluate calls, and a
 * real DialogHandler all need: `evaluate` runs the callback against a
 * controlled `window.Xrm`, and `waitForSelector`/`click` drive the dialog
 * race exactly as DialogHandler expects (mirrors dialog-handler.test.ts).
 */
function createPageStub(xrm: unknown, dialogsVisible: string[] = []) {
  const clicked: string[] = [];
  const page = {
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
  return { page, clicked };
}

function fakeEntityData(overrides: Record<string, unknown> = {}) {
  return {
    getId: () => '{11111111-1111-1111-1111-111111111111}',
    getEntityName: () => 'nwind_orders',
    getEntityReference: () => ({
      id: '{11111111-1111-1111-1111-111111111111}',
      entityType: 'nwind_orders',
      name: 'Order 1',
    }),
    getIsDirty: () => false,
    getPrimaryAttributeValue: () => 'Order 1',
    isValid: () => true,
    save: vi.fn(() => Promise.resolve()),
    refresh: vi.fn((_shouldSave: boolean) => Promise.resolve()),
    ...overrides,
  };
}

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

function buildInstance(xrm: unknown, dialogsVisible: string[] = []) {
  const { page, clicked } = createPageStub(xrm, dialogsVisible);
  const xrmHelper = new XrmHelper(page);
  const dialogHandler = new DialogHandler(page);
  return { entity: new Entity(xrmHelper, dialogHandler), clicked };
}

describe('Entity.getId / getEntityName / getEntityReference', () => {
  it('strips braces and lower-cases the record id', async () => {
    const xrm = { Page: { data: { entity: fakeEntityData() } } };
    const { entity } = buildInstance(xrm);

    expect(await entity.getId()).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('returns the entity logical name', async () => {
    const xrm = { Page: { data: { entity: fakeEntityData() } } };
    const { entity } = buildInstance(xrm);

    expect(await entity.getEntityName()).toBe('nwind_orders');
  });

  it('normalizes the entity reference id the same way', async () => {
    const xrm = { Page: { data: { entity: fakeEntityData() } } };
    const { entity } = buildInstance(xrm);

    const ref = await entity.getEntityReference();

    expect(ref).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      entityType: 'nwind_orders',
      name: 'Order 1',
    });
  });
});

describe('Entity.save', () => {
  it('saves and returns the record id when no dialog interrupts', async () => {
    const entityData = fakeEntityData();
    const xrm = { Page: { data: { entity: entityData, save: entityData.save } } };
    const { entity } = buildInstance(xrm);

    const id = await entity.save();

    expect(id).toBe('11111111-1111-1111-1111-111111111111');
    expect(entityData.save).toHaveBeenCalled();
  });

  it('aborts with DuplicateRecordsFoundError by default when duplicates are found, unwrapped by RethrownError', async () => {
    const entityData = fakeEntityData({ save: vi.fn(() => new Promise(() => undefined)) });
    const xrm = { Page: { data: { entity: entityData, save: entityData.save } } };
    const detect = DIALOG_SELECTORS[DialogKind.DuplicateDetection].detect;
    const { entity, clicked } = buildInstance(xrm, [detect]);

    const call = entity.save();

    await expect(call).rejects.toBeInstanceOf(DuplicateRecordsFoundError);
    // The caller-facing error is the dialog's own error, not our generic wrapper.
    await expect(call.catch((e) => e)).resolves.not.toBeInstanceOf(RethrownError);
    expect(clicked).toContain(DIALOG_SELECTORS[DialogKind.DuplicateDetection].abort);
  });

  it('proceeds past duplicates and saves when ignoreDuplicateCheck is true', async () => {
    // Real D365 only resolves Xrm.Page.data.save() once the "ignore and
    // save" dialog is dismissed — model that dependency explicitly rather
    // than resolving save() up front, so this test actually exercises the
    // dialog-then-save ordering, not just parallel independent promises.
    const saveCompletes = deferred<void>();
    const entityData = fakeEntityData({ save: vi.fn(() => saveCompletes.promise) });
    const xrm = { Page: { data: { entity: entityData, save: entityData.save } } };
    const proceedSelector = DIALOG_SELECTORS[DialogKind.DuplicateDetection].proceed;
    const detect = DIALOG_SELECTORS[DialogKind.DuplicateDetection].detect;
    const { entity, clicked } = buildInstance(xrm, [detect]);

    const savePromise = entity.save(true);

    await vi.waitFor(() => expect(clicked).toContain(proceedSelector));
    saveCompletes.resolve();

    await expect(savePromise).resolves.toBe('11111111-1111-1111-1111-111111111111');
  });

  it('wraps a save-side evaluate failure in a RethrownError', async () => {
    const xrm = {
      Page: {
        data: {
          entity: fakeEntityData(),
          save: () => {
            throw new Error('boom');
          },
        },
      },
    };
    const { entity } = buildInstance(xrm);

    await expect(entity.save()).rejects.toBeInstanceOf(RethrownError);
  });
});

describe('Entity.isDirty / getPrimaryAttributeValue / isValid / getFormType / refresh', () => {
  it('reports dirty state', async () => {
    const xrm = { Page: { data: { entity: fakeEntityData({ getIsDirty: () => true }) } } };
    const { entity } = buildInstance(xrm);

    expect(await entity.isDirty()).toBe(true);
  });

  it('returns the primary attribute value', async () => {
    const xrm = { Page: { data: { entity: fakeEntityData() } } };
    const { entity } = buildInstance(xrm);

    expect(await entity.getPrimaryAttributeValue()).toBe('Order 1');
  });

  it('reports validity', async () => {
    const xrm = { Page: { data: { entity: fakeEntityData({ isValid: () => false }) } } };
    const { entity } = buildInstance(xrm);

    expect(await entity.isValid()).toBe(false);
  });

  it('returns the form type', async () => {
    const xrm = { Page: { data: { entity: fakeEntityData() }, ui: { getFormType: () => 2 } } };
    const { entity } = buildInstance(xrm);

    expect(await entity.getFormType()).toBe(2);
  });

  it('refreshes, forwarding the save flag', async () => {
    const entityData = fakeEntityData();
    const xrm = { Page: { data: { entity: entityData, refresh: entityData.refresh } } };
    const { entity } = buildInstance(xrm);

    await entity.refresh(true);

    expect(entityData.refresh).toHaveBeenCalledWith(true);
  });

  it('wraps evaluate failures in a RethrownError', async () => {
    const xrm = {
      Page: {
        data: {
          get entity(): unknown {
            throw new Error('boom');
          },
        },
      },
    };
    const { entity } = buildInstance(xrm);

    await expect(entity.isDirty()).rejects.toBeInstanceOf(RethrownError);
  });
});
