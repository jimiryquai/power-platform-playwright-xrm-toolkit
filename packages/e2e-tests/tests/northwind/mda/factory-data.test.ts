// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Generic test-data factory verification against a live environment.
 *
 * Exercises the toolkit's generic RecordFactory (issue #28) against three
 * different Northwind entities with no entity-specific factory subclass —
 * including linking them via bindLookup(), mirroring CCA's ACCOUNT_WITH_CONTACT
 * multi-entity scenario — and exercises createBulk's collision-safe naming, the
 * property that makes it safe to run this suite with fullyParallel and
 * multiple workers.
 *
 * Every record this suite creates is deleted via Xrm.WebApi in a `finally`
 * block, regardless of assertion outcome.
 *
 * @requires Authentication: npm run auth:mda:headful
 * @requires MODEL_DRIVEN_APP_URL in .env
 */

import { RecordFactory, bindLookup } from 'power-platform-playwright-toolkit';
import { test, expect } from '../../../fixtures/mda.fixtures';
import { NORTHWIND_SCENARIOS, NWIND_ORDERNUMBER_MAX_LENGTH } from '../../data/northwind-scenarios';

test.describe('Generic RecordFactory - live Dataverse verification', () => {
  test('creates a multi-entity scenario linking three different entities', async ({
    modelDrivenApp,
  }) => {
    const scenario = NORTHWIND_SCENARIOS.ORDER_WITH_CUSTOMER_AND_EMPLOYEE;
    // Deleted in reverse: the order holds the lookups, so it must go first.
    const created: { logicalName: string; id: string }[] = [];

    try {
      const customer = RecordFactory.create(scenario.data.customer);
      const customerResult = await modelDrivenApp.webApi.createRecord(
        scenario.entities.customer.logicalName,
        customer
      );
      created.push({ logicalName: scenario.entities.customer.logicalName, id: customerResult.id });

      const employee = RecordFactory.create(scenario.data.employee);
      const employeeResult = await modelDrivenApp.webApi.createRecord(
        scenario.entities.employee.logicalName,
        employee
      );
      created.push({ logicalName: scenario.entities.employee.logicalName, id: employeeResult.id });

      // The order isn't complete without its lookups — bind it to the
      // customer/employee just created before creating the order itself.
      const order = RecordFactory.create({
        ...scenario.data.order,
        data: {
          ...scenario.data.order.data,
          ...bindLookup(
            scenario.lookups.customer,
            scenario.entities.customer.entitySetName,
            customerResult.id
          ),
          ...bindLookup(
            scenario.lookups.employee,
            scenario.entities.employee.entitySetName,
            employeeResult.id
          ),
        },
      });
      const orderResult = await modelDrivenApp.webApi.createRecord(
        scenario.entities.order.logicalName,
        order
      );
      created.push({ logicalName: scenario.entities.order.logicalName, id: orderResult.id });

      // Read the order back through its lookups, proving the relationship
      // actually landed rather than three independently-created records.
      const savedOrder = await modelDrivenApp.webApi.retrieveRecord(
        scenario.entities.order.logicalName,
        orderResult.id,
        `?$select=nwind_ordernumber,nwind_shippingfee` +
          `&$expand=${scenario.lookups.customer}($select=nwind_company),` +
          `${scenario.lookups.employee}($select=nwind_lastname)`
      );
      expect(savedOrder.nwind_ordernumber).toBe(order.nwind_ordernumber);
      expect(savedOrder.nwind_shippingfee).toBe(25);
      expect(savedOrder[scenario.lookups.customer].nwind_company).toBe(customer.nwind_company);
      expect(savedOrder[scenario.lookups.employee].nwind_lastname).toBe(employee.nwind_lastname);
    } finally {
      for (const record of [...created].reverse()) {
        await modelDrivenApp.webApi
          .deleteRecord(record.logicalName, record.id)
          .catch(() => undefined);
      }
    }
  });

  test('createBulk produces collision-safe unique names under real Dataverse creates', async ({
    modelDrivenApp,
  }) => {
    const bulkOrders = RecordFactory.createBulk(5, {
      nameField: 'nwind_ordernumber',
      maxLength: NWIND_ORDERNUMBER_MAX_LENGTH,
    });
    const createdIds: string[] = [];

    try {
      // Dataverse itself would reject a name collision were one to occur —
      // every createRecord call here succeeding is part of the proof.
      for (const order of bulkOrders) {
        const { id } = await modelDrivenApp.webApi.createRecord('nwind_orders', order);
        createdIds.push(id);
      }

      expect(createdIds).toHaveLength(5);
      expect(new Set(createdIds).size).toBe(5);

      const savedNames = await Promise.all(
        createdIds.map(async (id) => {
          const record = await modelDrivenApp.webApi.retrieveRecord(
            'nwind_orders',
            id,
            '?$select=nwind_ordernumber'
          );
          return record.nwind_ordernumber as string;
        })
      );

      expect(new Set(savedNames).size).toBe(5);
    } finally {
      for (const id of createdIds) {
        await modelDrivenApp.webApi.deleteRecord('nwind_orders', id).catch(() => undefined);
      }
    }
  });
});
