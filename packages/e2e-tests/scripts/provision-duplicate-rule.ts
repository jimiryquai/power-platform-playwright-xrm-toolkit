// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/*!
 * Provision a published duplicate-detection rule for the DialogHandler e2e test.
 *
 * D365 only raises the duplicate-detection dialog when a *published* duplicate
 * rule matches, and the stock Northwind solution ships none. Without one, the
 * duplicate half of the DialogHandler test has nothing to verify against.
 *
 * The rule matches nwind_ordernumber exactly. Every other test generates a unique
 * order number, so an exact-match rule only fires for records deliberately created
 * as duplicates.
 *
 * Idempotent — re-running reports the existing rule instead of creating a second.
 *
 * Usage:
 *   npm run provision:duplicate-rule            # requires `npm run auth:mda` first
 *   npm run provision:duplicate-rule -- --headful
 */

import { chromium } from '@playwright/test';
import { getStorageStatePath, getAuthBrowserChannel } from 'power-platform-playwright-toolkit';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Targets `account`, not `nwind_orders`.
 *
 * Duplicate detection is a per-table metadata flag, and the Northwind tables ship
 * with it off ("Duplicate detection is not supported on this record type"). Turning
 * it on would mean editing the metadata of a solution table — a schema change well
 * beyond adding a rule. `account` is a standard table with it enabled by default,
 * and the dialog D365 raises is identical whichever table triggers it.
 */
const RULE_NAME = 'Accounts with the same Account Name';
const ENTITY = 'account';
const ATTRIBUTE = 'name';

/** duplicaterulecondition operatorcode for "Exact Match". */
const OPERATOR_EXACT_MATCH = 0;

/** duplicaterule statecode when published. */
const STATE_PUBLISHED = 1;

async function main() {
  const email = process.env.MS_AUTH_EMAIL;
  const modelDrivenAppUrl = process.env.MODEL_DRIVEN_APP_URL;

  if (!email) throw new Error('MS_AUTH_EMAIL is required');
  if (!modelDrivenAppUrl) throw new Error('MODEL_DRIVEN_APP_URL is required');

  const mdaStatePath = path.join(
    path.dirname(getStorageStatePath(email)),
    `state-mda-${email}.json`
  );

  const headless = !process.argv.includes('--headful');
  const channel = getAuthBrowserChannel() ?? 'msedge';

  console.log('🔧 Provisioning duplicate-detection rule');
  console.log(`   Entity:    ${ENTITY}`);
  console.log(`   Attribute: ${ATTRIBUTE}`);
  console.log(`   Rule name: ${RULE_NAME}\n`);

  const browser = await chromium.launch({
    headless,
    ...(channel === 'chromium' ? {} : { channel }),
  });

  try {
    const context = await browser.newContext({ storageState: mdaStatePath });
    const page = await context.newPage();

    await page.goto(modelDrivenAppUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => typeof (window as any).Xrm !== 'undefined', undefined, {
      timeout: 60_000,
    });

    const result = await page.evaluate(
      async ({ ruleName, entity, attribute, operatorCode, statePublished }) => {
        // No named function expressions in here: tsx/esbuild rewrites them with a
        // `__name` helper that does not exist in the browser, and the evaluate
        // fails with "ReferenceError: __name is not defined" before running.
        try {
          const xrm = (window as any).Xrm;
          const clientUrl = xrm.Utility.getGlobalContext().getClientUrl();

          const existing = await xrm.WebApi.retrieveMultipleRecords(
            'duplicaterule',
            `?$select=duplicateruleid,name,statecode&$filter=name eq '${ruleName}'`
          );

          if (existing.entities.length > 0) {
            const rule = existing.entities[0];
            if (rule.statecode === statePublished) {
              return { status: 'already-published', id: rule.duplicateruleid };
            }
            // Exists but unpublished — publish it rather than creating a duplicate rule.
            const publishResponse = await fetch(
              `${clientUrl}/api/data/v9.2/duplicaterules(${rule.duplicateruleid})/Microsoft.Dynamics.CRM.PublishDuplicateRule`,
              { method: 'POST', headers: { 'Content-Type': 'application/json' } }
            );
            if (!publishResponse.ok) {
              return {
                status: 'publish-failed',
                id: rule.duplicateruleid,
                detail: await publishResponse.text(),
              };
            }
            return { status: 'published-existing', id: rule.duplicateruleid };
          }

          const rule = await xrm.WebApi.createRecord('duplicaterule', {
            name: ruleName,
            baseentityname: entity,
            matchingentityname: entity,
            iscasesensitive: false,
          });

          await xrm.WebApi.createRecord('duplicaterulecondition', {
            baseattributename: attribute,
            matchingattributename: attribute,
            operatorcode: operatorCode,
            'regardingobjectid@odata.bind': `/duplicaterules(${rule.id})`,
          });

          const publishResponse = await fetch(
            `${clientUrl}/api/data/v9.2/duplicaterules(${rule.id})/Microsoft.Dynamics.CRM.PublishDuplicateRule`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' } }
          );

          if (!publishResponse.ok) {
            return { status: 'publish-failed', id: rule.id, detail: await publishResponse.text() };
          }

          return { status: 'created-and-published', id: rule.id };
        } catch (error) {
          // Xrm.WebApi rejects with a plain object, which crosses the evaluate
          // boundary as "Object" and hides the reason — stringify it here instead.
          const failure = error as { message?: string };
          const detail =
            typeof error === 'string'
              ? error
              : (failure?.message ??
                JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})));
          return { status: 'error', detail };
        }
      },
      {
        ruleName: RULE_NAME,
        entity: ENTITY,
        attribute: ATTRIBUTE,
        operatorCode: OPERATOR_EXACT_MATCH,
        statePublished: STATE_PUBLISHED,
      }
    );

    if (result.status === 'error') {
      console.error(`❌ Dataverse rejected the request:\n${result.detail}`);
      process.exitCode = 1;
      return;
    }

    if (result.status === 'publish-failed') {
      console.error(`❌ Rule ${result.id} created but publishing failed:\n${result.detail}`);
      process.exitCode = 1;
      return;
    }

    console.log(`✅ ${result.status} — duplicaterule ${result.id}`);
    console.log('\nPublishing is asynchronous; allow a minute before the dialog fires.');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('❌ Provisioning failed:', error?.message ?? error);
  process.exit(1);
});
