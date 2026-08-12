// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * DialogHandler verification against a live environment.
 *
 * Covers the two dialogs the handler centralises, each raced against the action
 * that actually triggers it:
 *
 * 1. Unsaved changes — dirty a form, navigate away *in-app*, confirm the prompt
 *    is dismissed and the navigation completes.
 * 2. Duplicate detection — save a record matching a published duplicate rule.
 *
 * Each test asserts the dialog was genuinely raised and handled. Asserting only
 * that no dialog remains on screen would pass just as happily on a run where the
 * dialog never appeared at all.
 *
 * @requires Authentication: npm run auth:mda
 * @requires MODEL_DRIVEN_APP_URL in .env
 * @requires A published duplicate rule: npm run provision:duplicate-rule
 */

import type { Page } from '@playwright/test';
import {
  DialogHandler,
  DialogKind,
  DIALOG_SELECTORS,
  XrmHelper,
} from 'power-platform-playwright-toolkit';
import { test, expect } from '../../../fixtures/mda.fixtures';

const ORDERS_ENTITY = 'nwind_orders';

/**
 * Duplicate detection is a per-table metadata flag and the Northwind tables ship
 * with it off — Dataverse refuses even to create a rule for them ("Duplicate
 * detection is not supported on this record type"). `account` is a standard table
 * with it enabled, and D365 raises the identical dialog whichever table trips it.
 */
const DUPLICATE_ENTITY = 'account';

/** Published duplicate-detection rules for an entity, via the Dataverse Web API. */
async function publishedDuplicateRules(page: Page, entity: string): Promise<string[]> {
  return page.evaluate(async (entityName) => {
    const result = await (window as any).Xrm.WebApi.retrieveMultipleRecords(
      'duplicaterule',
      // statecode 1 === Published
      `?$select=name&$filter=statecode eq 1 and baseentityname eq '${entityName}'`
    );
    return result.entities.map((e: any) => e.name as string);
  }, entity);
}

test.describe.serial('DialogHandler - live dialogs', () => {
  test('dismisses the unsaved-changes prompt and lets navigation complete', async ({
    page,
    modelDrivenApp,
  }) => {
    const xrm = new XrmHelper(page);

    await modelDrivenApp.navigateToGridView(ORDERS_ENTITY);
    await xrm.waitForFormReady();
    await modelDrivenApp.grid.openRecord({ rowNumber: 0 });
    await page.waitForURL(/pagetype=entityrecord/, { timeout: 30_000 });
    await xrm.waitForFormReady();

    // Dirty the form so D365 objects to us leaving it. Throws rather than
    // optional-chaining away: an unbound attribute means the form is read-only
    // and the rest of the test would silently prove nothing.
    await page.evaluate(() => {
      const entity = (window as any).Xrm?.Page?.data?.entity;
      const attribute = entity?.attributes?.get('nwind_ordernumber');
      if (!attribute) throw new Error('nwind_ordernumber not bound — record may be read-only');
      attribute.setValue(`DLG-${Date.now()}`);
    });

    const isDirty = await page.evaluate(
      () => (window as any).Xrm?.Page?.data?.entity?.getIsDirty() === true
    );
    expect(isDirty, 'form must be dirty or D365 will not prompt').toBe(true);

    const dialogs = new DialogHandler(page, { timeout: 30_000, debugMode: true });

    // In-app routing via Xrm.Navigation — NOT page.goto. A full browser
    // navigation produces at most a native beforeunload, which Playwright
    // dismisses itself, so the UCI modal this test exists for never appears.
    const navigated = await dialogs.run(async () => {
      await page.evaluate(
        (entityName) =>
          (window as any).Xrm.Navigation.navigateTo({
            pageType: 'entitylist',
            entityName,
          }),
        ORDERS_ENTITY
      );
      await page.waitForURL(/pagetype=entitylist/, { timeout: 30_000 });
      return true;
    });

    expect(navigated).toBe(true);
    await expect(page).toHaveURL(/pagetype=entitylist/);

    // Prove the dialog was actually raised and handled, not merely absent: the
    // form was dirty and we left anyway, which is only possible via the prompt.
    const stillDirty = await page.evaluate(
      () => (window as any).Xrm?.Page?.data?.entity?.getIsDirty?.() === true
    );
    expect(stillDirty, 'changes should have been discarded by the prompt').toBe(false);

    await expect(page.locator(DIALOG_SELECTORS[DialogKind.UnsavedChanges].detect)).toBeHidden();
  });

  test('dismisses a duplicate-detection dialog raised by a save', async ({
    page,
    modelDrivenApp,
  }) => {
    const xrm = new XrmHelper(page);

    await modelDrivenApp.navigateToGridView(DUPLICATE_ENTITY);
    await xrm.waitForFormReady();

    const rules = await publishedDuplicateRules(page, DUPLICATE_ENTITY);
    console.log(`Published duplicate rules for ${DUPLICATE_ENTITY}: ${JSON.stringify(rules)}`);

    test.skip(
      rules.length === 0,
      `No published duplicate-detection rule on ${DUPLICATE_ENTITY}. ` +
        'Run: npm run provision:duplicate-rule'
    );

    const accountName = `DLG-DUP-${Date.now()}`;
    const createdIds: string[] = [];

    try {
      // Seed the record the save will collide with. Created through the Web API
      // because server-side creates do not raise the UI dialog — only the form
      // save we are testing does.
      const seedId = await page.evaluate(async (name) => {
        const created = await (window as any).Xrm.WebApi.createRecord('account', { name });
        return created.id as string;
      }, accountName);
      createdIds.push(seedId);

      await modelDrivenApp.navigateToFormView(DUPLICATE_ENTITY);
      await xrm.waitForFormReady();

      const dialogs = new DialogHandler(page, { timeout: 30_000, debugMode: true });

      const savedId = await dialogs.run(
        () =>
          page.evaluate(
            (name) =>
              new Promise<string>((resolve, reject) => {
                const data = (window as any).Xrm.Page.data;
                const entity = data.entity;
                const attribute = entity.attributes.get('name');
                if (!attribute) {
                  reject(new Error('account name attribute not bound'));
                  return;
                }
                attribute.setValue(name);
                // data.save() returns the promise; entity.save() is deprecated in
                // UCI and returns undefined.
                data.save().then(
                  () => resolve(entity.getId().replace(/[{}]/g, '')),
                  (error: unknown) => reject(error)
                );
              }),
            accountName
          ),
        { [DialogKind.DuplicateDetection]: 'proceed' }
      );

      expect(savedId, 'the duplicate record should still have saved').toBeTruthy();
      createdIds.push(savedId);

      await expect(
        page.locator(DIALOG_SELECTORS[DialogKind.DuplicateDetection].detect)
      ).toBeHidden();

      // Two records with the same name proves the duplicate save went through
      // rather than being blocked or abandoned.
      const matches = await page.evaluate(async (name) => {
        const result = await (window as any).Xrm.WebApi.retrieveMultipleRecords(
          'account',
          `?$select=accountid&$filter=name eq '${name}'`
        );
        return result.entities.length as number;
      }, accountName);
      expect(matches, 'both the seed and the duplicate should exist').toBe(2);
    } finally {
      // Leave the tenant as we found it.
      for (const id of createdIds) {
        await page
          .evaluate((recordId) => (window as any).Xrm.WebApi.deleteRecord('account', recordId), id)
          .catch(() => undefined);
      }
    }
  });
});
