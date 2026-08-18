// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Named, reusable multi-entity test-data scenarios for the Northwind Traders solution.
//
// Ported and generalized from the CCA framework's scenario-fixture pattern
// (tests/data/fixtures/account-scenarios.ts) per issue #28. Each scenario bundles
// CreateRecordOptions for more than one entity, built by the toolkit's generic
// RecordFactory rather than an entity-specific factory subclass per table, and
// (like CCA's ACCOUNT_WITH_CONTACT scenario) links the entities via @odata.bind
// rather than creating unrelated records.
//
// Logical names, entity-set names, primary-name fields, and lookup navigation
// properties below were confirmed against the live environment's Dataverse
// Web API metadata (`EntityDefinitions`, `ManyToOneRelationships`), not guessed —
// see the "Northwind entity/relationship metadata" note in the toolkit README.

import type { CreateRecordOptions } from 'power-platform-playwright-toolkit';

/**
 * nwind_orders' Dataverse MaxLength for nwind_ordernumber — confirmed via
 * `EntityDefinitions(LogicalName='nwind_orders')/Attributes(LogicalName='nwind_ordernumber')/
 * Microsoft.Dynamics.CRM.StringAttributeMetadata`, not guessed. Exported so every caller
 * building an order name (this scenario, and any bulk-creation test) shares one source of
 * truth instead of repeating the literal.
 */
export const NWIND_ORDERNUMBER_MAX_LENGTH = 8;

interface NorthwindEntityRef {
  /** Logical name — pass to WebApi.createRecord/retrieveRecord/deleteRecord. */
  logicalName: string;
  /**
   * OData entity-set (collection) name — pass as the target of `bindLookup()`
   * when this entity is the referenced side of a lookup. Not simply the
   * logical name pluralized once (Dataverse pluralizes whatever the logical
   * name already is), so it's tracked separately rather than derived.
   */
  entitySetName: string;
}

interface OrderWithCustomerAndEmployeeScenario {
  description: string;
  entities: {
    order: NorthwindEntityRef;
    customer: NorthwindEntityRef;
    employee: NorthwindEntityRef;
  };
  /** nwind_orders' lookup navigation property names, for bindLookup(). */
  lookups: {
    customer: string;
    employee: string;
  };
  data: {
    order: CreateRecordOptions;
    customer: CreateRecordOptions;
    employee: CreateRecordOptions;
  };
}

/**
 * Multi-entity scenarios for Northwind-based tests. Each scenario's `data`
 * holds CreateRecordOptions per entity — pass them to `RecordFactory.create()`
 * at the call site to get a fresh, uniquely-named payload per test run. The
 * order record isn't complete on its own: bind it to the created customer and
 * employee ids via `bindLookup(scenario.lookups.customer, ...)` /
 * `bindLookup(scenario.lookups.employee, ...)` before creating it.
 */
export const NORTHWIND_SCENARIOS: Record<string, OrderWithCustomerAndEmployeeScenario> = {
  /**
   * An order linked to the customer and employee associated with it via
   * nwind_orders' real lookup fields (nwind_CustomerID, nwind_EmployeeID).
   * Demonstrates the generic RecordFactory working across three different
   * entities (nwind_orders, nwind_customers, nwind_employees) with no
   * entity-specific factory subclass — mirroring CCA's ACCOUNT_WITH_CONTACT
   * multi-entity scenario, which links account + contact the same way.
   */
  ORDER_WITH_CUSTOMER_AND_EMPLOYEE: {
    description:
      'An order linked to the customer and employee associated with it, generalizing the CCA ' +
      "framework's ACCOUNT_WITH_CONTACT-style multi-entity scenario to Northwind.",
    entities: {
      order: { logicalName: 'nwind_orders', entitySetName: 'nwind_orderses' },
      customer: { logicalName: 'nwind_customers', entitySetName: 'nwind_customerses' },
      employee: { logicalName: 'nwind_employees', entitySetName: 'nwind_employeeses' },
    },
    lookups: {
      customer: 'nwind_CustomerID',
      employee: 'nwind_EmployeeID',
    },
    data: {
      order: {
        nameField: 'nwind_ordernumber',
        namePrefix: 'Scenario Order',
        maxLength: NWIND_ORDERNUMBER_MAX_LENGTH,
        data: { nwind_shippingfee: 25 },
      },
      customer: {
        nameField: 'nwind_company',
        namePrefix: 'Scenario Customer',
      },
      employee: {
        nameField: 'nwind_lastname',
        namePrefix: 'Scenario Employee',
      },
    },
  },
};

export type NorthwindScenarioName = keyof typeof NORTHWIND_SCENARIOS;
