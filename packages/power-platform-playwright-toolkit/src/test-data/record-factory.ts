// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Generic, entity-agnostic test-data factory.
 *
 * Ported and generalized from the CCA framework's per-entity factory pattern
 * (`AccountFactory`, `ContactFactory`) per issue #28 — one factory builds a
 * valid, uniquely-named record payload for any Dataverse entity, rather than
 * requiring an entity-specific subclass per table.
 *
 * @packageDocumentation
 */

/**
 * Options for {@link RecordFactory.create} / {@link RecordFactory.createBulk}.
 */
export interface CreateRecordOptions {
  /**
   * Logical name of the field that holds the record's unique/display name,
   * e.g. `nwind_ordernumber` for `nwind_orders`, `nwind_company` for
   * `nwind_customers`.
   */
  nameField: string;
  /** Prefix for the generated unique name. Default: `'Test Record'`. */
  namePrefix?: string;
  /**
   * Max length the generated name must fit within, for fields with a tight
   * Dataverse `MaxLength` (e.g. `nwind_ordernumber` allows only 8 characters —
   * check `EntityDefinitions(...)/Attributes(...)/Microsoft.Dynamics.CRM.StringAttributeMetadata`
   * rather than assuming a field has room for the readable `<prefix> <timestamp>-<random>` form).
   */
  maxLength?: number;
  /** Additional field values to merge into the generated record. */
  data?: Record<string, unknown>;
}

/**
 * Builds valid, uniquely-named record payloads for `WebApi.createRecord()`-style
 * calls, for any entity.
 *
 * @example
 * ```typescript
 * const order = RecordFactory.create({
 *   nameField: 'nwind_ordernumber',
 *   data: { nwind_orderamount: 100 },
 * });
 * const { id } = await modelDrivenApp.webApi.createRecord('nwind_orders', order);
 * ```
 */
export class RecordFactory {
  /**
   * Builds a single record payload with a collision-safe unique value in
   * `nameField`.
   */
  static create(options: CreateRecordOptions): Record<string, unknown> {
    const { nameField, namePrefix = 'Test Record', maxLength, data = {} } = options;
    return {
      [nameField]: uniqueRecordName(namePrefix, maxLength),
      ...data,
    };
  }

  /**
   * Builds `count` record payloads, each with a collision-safe unique name.
   * Names are numbered (`<prefix> 1 ...`, `<prefix> 2 ...`) for readability —
   * unless `maxLength` is tight enough that numbering wouldn't fit, in which
   * case the compact fallback in `uniqueRecordName` already guarantees
   * uniqueness without it.
   */
  static createBulk(count: number, options: CreateRecordOptions): Record<string, unknown>[] {
    const namePrefix = options.namePrefix ?? 'Test Record';
    return Array.from({ length: count }, (_, i) =>
      RecordFactory.create({
        ...options,
        namePrefix: options.maxLength ? namePrefix : `${namePrefix} ${i + 1}`,
      })
    );
  }
}

/**
 * Builds a collision-safe unique name: `<prefix> <timestamp>-<random>`.
 *
 * Combines a millisecond timestamp with a random base-36 suffix so that
 * parallel Playwright workers creating records in the same millisecond still
 * produce distinct names. When that readable form doesn't fit `maxLength`,
 * falls back to a compact, still-collision-safe value built from base-36
 * timestamp + random characters, keeping the rightmost (most-recently-varying)
 * characters if it must be trimmed further.
 */
export function uniqueRecordName(prefix: string, maxLength?: number): string {
  const random = Math.random().toString(36).slice(2, 8);
  const readable = `${prefix} ${Date.now()}-${random}`;
  if (maxLength === undefined || readable.length <= maxLength) {
    return readable;
  }

  const compact = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return compact.slice(-maxLength);
}

/**
 * Builds an `@odata.bind` relationship payload for a lookup field, for
 * spreading into a factory's `data` option.
 *
 * @param navigationProperty - The lookup's navigation property name, from the
 *   referencing entity's `ManyToOneRelationships` metadata (e.g. `nwind_CustomerID`
 *   — note this is the relationship's nav property, not the plain attribute name
 *   `nwind_customerid`).
 * @param entitySetName - The target entity's **entity-set** (OData collection) name.
 *   This is not always the entity's logical name pluralized once — Dataverse
 *   pluralizes whatever the logical name already is, so a logical name that's
 *   already plural (e.g. `nwind_customers`) commonly gets an entity-set name
 *   pluralized again (`nwind_customerses`). Look this up via
 *   `EntityDefinitions?$select=LogicalName,EntitySetName` rather than assuming it.
 * @param id - The target record's id.
 *
 * @example
 * ```typescript
 * RecordFactory.create({
 *   nameField: 'nwind_ordernumber',
 *   data: bindLookup('nwind_CustomerID', 'nwind_customerses', customerId),
 * });
 * ```
 */
export function bindLookup(
  navigationProperty: string,
  entitySetName: string,
  id: string
): Record<string, string> {
  return { [`${navigationProperty}@odata.bind`]: `/${entitySetName}(${id})` };
}
