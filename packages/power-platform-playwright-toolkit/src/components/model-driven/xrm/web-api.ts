/**
 * Dataverse Web API operations via `window.Xrm.WebApi`.
 *
 * @packageDocumentation
 */

import { XrmHelper } from '../../../core/xrm-helper';
import { RethrownError } from '../../../core/rethrown-error';

/**
 * WebApi — D365 Web API record operations via `window.Xrm.WebApi.*`.
 *
 * Pure Xrm layer: no DOM interaction. Ported from the CCA framework per
 * ADR 0001, replacing the overlapping parts of MS's `FormComponent`.
 *
 * @example
 * ```typescript
 * const modelDrivenApp = new ModelDrivenAppPage(page);
 * const { id } = await modelDrivenApp.webApi.createRecord('nwind_orders', {
 *   nwind_ordernumber: 'TEST-12345',
 * });
 * const record = await modelDrivenApp.webApi.retrieveRecord('nwind_orders', id);
 * ```
 */
export class WebApi {
  constructor(private xrmHelper: XrmHelper) {}

  /**
   * Creates a single record.
   * @returns The id and entityType of the created record.
   */
  async createRecord(
    entityLogicalName: string,
    data: any
  ): Promise<{ id: string; entityType: string }> {
    try {
      await this.xrmHelper.waitForXrmReady();
      return await this.xrmHelper.page.evaluate(
        ({ entityName, recordData }) => {
          return (window as any).Xrm.WebApi.createRecord(entityName, recordData);
        },
        { entityName: entityLogicalName, recordData: data }
      );
    } catch (e) {
      throw new RethrownError(`Error creating ${entityLogicalName} record`, e as Error);
    }
  }

  /**
   * Retrieves a single record.
   * @param options - OData query string (e.g. `?$select=name`).
   * @returns The record with the requested attributes.
   */
  async retrieveRecord(entityLogicalName: string, id: string, options?: string): Promise<any> {
    try {
      await this.xrmHelper.waitForXrmReady();
      return await this.xrmHelper.page.evaluate(
        ({ entityName, recordId, queryOptions }) => {
          return (window as any).Xrm.WebApi.retrieveRecord(entityName, recordId, queryOptions);
        },
        { entityName: entityLogicalName, recordId: id, queryOptions: options }
      );
    } catch (e) {
      throw new RethrownError(`Error retrieving ${entityLogicalName} record '${id}'`, e as Error);
    }
  }

  /**
   * Retrieves a single page of records.
   * @returns The page's entities, plus `@odata.nextLink` when more pages remain.
   */
  async retrieveMultipleRecords(
    entityLogicalName: string,
    options?: string,
    maxPageSize?: number
  ): Promise<{
    entities: any[];
    '@odata.nextLink'?: string;
    '@odata.count'?: number;
  }> {
    try {
      await this.xrmHelper.waitForXrmReady();
      return await this.xrmHelper.page.evaluate(
        ({ entityName, queryOptions, pageSize }) => {
          return (window as any).Xrm.WebApi.retrieveMultipleRecords(
            entityName,
            queryOptions,
            pageSize
          );
        },
        { entityName: entityLogicalName, queryOptions: options, pageSize: maxPageSize }
      );
    } catch (e) {
      throw new RethrownError(`Error retrieving multiple ${entityLogicalName} records`, e as Error);
    }
  }

  /**
   * Retrieves every record matching the query, following `@odata.nextLink`
   * across pages automatically.
   *
   * @returns All entities across every page.
   */
  async retrieveAllRecords(
    entityLogicalName: string,
    options?: string,
    maxPageSize?: number
  ): Promise<any[]> {
    const allEntities: any[] = [];
    let result = await this.retrieveMultipleRecords(entityLogicalName, options, maxPageSize);
    allEntities.push(...result.entities);

    while (result['@odata.nextLink']) {
      // Xrm.WebApi.retrieveMultipleRecords accepts a full nextLink URL in the
      // options position and pages from it directly.
      result = await this.retrieveMultipleRecords(
        entityLogicalName,
        result['@odata.nextLink'],
        maxPageSize
      );
      allEntities.push(...result.entities);
    }

    return allEntities;
  }

  /**
   * Updates a single record.
   * @returns The id and entityType of the updated record.
   */
  async updateRecord(
    entityLogicalName: string,
    id: string,
    data: any
  ): Promise<{ id: string; entityType: string }> {
    try {
      await this.xrmHelper.waitForXrmReady();
      return await this.xrmHelper.page.evaluate(
        ({ entityName, recordId, recordData }) => {
          return (window as any).Xrm.WebApi.updateRecord(entityName, recordId, recordData);
        },
        { entityName: entityLogicalName, recordId: id, recordData: data }
      );
    } catch (e) {
      throw new RethrownError(`Error updating ${entityLogicalName} record '${id}'`, e as Error);
    }
  }

  /**
   * Deletes a single record.
   */
  async deleteRecord(entityLogicalName: string, id: string): Promise<any> {
    try {
      await this.xrmHelper.waitForXrmReady();
      return await this.xrmHelper.page.evaluate(
        ({ entityName, recordId }) => {
          return (window as any).Xrm.WebApi.deleteRecord(entityName, recordId);
        },
        { entityName: entityLogicalName, recordId: id }
      );
    } catch (e) {
      throw new RethrownError(`Error deleting ${entityLogicalName} record '${id}'`, e as Error);
    }
  }
}
