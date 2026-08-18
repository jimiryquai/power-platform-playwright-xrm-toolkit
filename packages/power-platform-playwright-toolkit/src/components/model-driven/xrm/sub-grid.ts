/**
 * Subgrid operations via `window.Xrm.Page.getControl()`.
 *
 * @packageDocumentation
 */

import { XrmHelper } from '../../../core/xrm-helper';
import { RethrownError } from '../../../core/rethrown-error';

/**
 * SubGrid — D365 form subgrid operations via `window.Xrm.Page.getControl()`.
 *
 * Pure Xrm layer: no DOM interaction, except `openNthRecord`, which — like
 * the Xrm client API itself has no in-place "open this row" call — navigates
 * by building the record's form URL from the grid's entity reference and
 * going to it directly.
 *
 * Ported from the CCA framework per ADR 0001.
 *
 * @example
 * ```typescript
 * const modelDrivenApp = new ModelDrivenAppPage(page);
 * const count = await modelDrivenApp.subGrid.getRecordCount('Orders_SubGrid');
 * await modelDrivenApp.subGrid.openNthRecord('Orders_SubGrid', 0);
 * ```
 */
export class SubGrid {
  constructor(private xrmHelper: XrmHelper) {}

  /**
   * Gets the subgrid's total record count (across all pages).
   * @returns The count, or `undefined` if the subgrid control isn't found.
   */
  async getRecordCount(subgridName: string): Promise<number | undefined> {
    try {
      await this.xrmHelper.waitForXrmReady();

      return await this.xrmHelper.page.evaluate((name: string) => {
        const control = (window as any).Xrm.Page.getControl(name);
        if (!control) return undefined;
        return control.getGrid().getTotalRecordCount();
      }, subgridName);
    } catch (e) {
      throw new RethrownError(
        `Error getting record count for subgrid '${subgridName}'`,
        e as Error
      );
    }
  }

  /**
   * Gets the count of records currently loaded in the visible page.
   * @returns The count, or `undefined` if the subgrid control isn't found.
   */
  async getVisibleRecordCount(subgridName: string): Promise<number | undefined> {
    try {
      await this.xrmHelper.waitForXrmReady();

      return await this.xrmHelper.page.evaluate((name: string) => {
        const control = (window as any).Xrm.Page.getControl(name);
        if (!control) return undefined;
        return control.getGrid().getRows().getLength();
      }, subgridName);
    } catch (e) {
      throw new RethrownError(
        `Error getting visible record count for subgrid '${subgridName}'`,
        e as Error
      );
    }
  }

  /**
   * Opens the subgrid's record at the given zero-based index by navigating
   * the page to that record's form.
   * @returns The opened record's entity reference (id, entityType).
   */
  async openNthRecord(
    subgridName: string,
    recordNumber: number
  ): Promise<{ id: string; entityType: string }> {
    try {
      await this.xrmHelper.waitForXrmReady();

      const recordReference = await this.xrmHelper.page.evaluate(
        ({ name, position }) => {
          const control = (window as any).Xrm.Page.getControl(name);
          if (!control) throw new Error(`Subgrid control '${name}' not found on form`);

          const grid = control.getGrid();
          const rows = grid.getRows();

          if (position >= rows.getLength()) {
            throw new Error(
              `Record index ${position} is out of range. Subgrid has ${rows.getLength()} records.`
            );
          }

          const record = rows.get(position).getData();
          const entityRef = record.getEntity().getEntityReference();

          return { id: entityRef.id, entityType: entityRef.entityType };
        },
        { name: subgridName, position: recordNumber }
      );

      // Carry `appid` forward from the current URL — dropping it makes D365
      // session-restore land on an error page instead of the record (the
      // same reason navigateToGridView/navigateToFormView always re-attach
      // it; see AppProvider.getModelDrivenAppPage's comment on this).
      const currentUrl = new URL(this.xrmHelper.page.url());
      const entityFormUrl = new URL('/main.aspx', currentUrl.origin);
      entityFormUrl.searchParams.set('etn', recordReference.entityType);
      entityFormUrl.searchParams.set('id', recordReference.id);
      entityFormUrl.searchParams.set('pagetype', 'entityrecord');
      const appId = currentUrl.searchParams.get('appid');
      if (appId) {
        entityFormUrl.searchParams.set('appid', appId);
      }

      await this.xrmHelper.page.goto(entityFormUrl.toString());
      await this.xrmHelper.waitForFormReady();

      return recordReference;
    } catch (e) {
      throw new RethrownError(
        `Error opening record ${recordNumber} in subgrid '${subgridName}'`,
        e as Error
      );
    }
  }

  /**
   * Gets the entity logical name the subgrid displays.
   * @returns The logical name, or `undefined` if the subgrid control isn't found.
   */
  async getEntityName(subgridName: string): Promise<string | undefined> {
    try {
      await this.xrmHelper.waitForXrmReady();

      return await this.xrmHelper.page.evaluate((name: string) => {
        const control = (window as any).Xrm.Page.getControl(name);
        if (!control) return undefined;
        return control.getEntityName();
      }, subgridName);
    } catch (e) {
      throw new RethrownError(`Error getting entity name for subgrid '${subgridName}'`, e as Error);
    }
  }

  /**
   * Refreshes the subgrid's data.
   */
  async refresh(subgridName: string): Promise<void> {
    try {
      await this.xrmHelper.waitForXrmReady();

      await this.xrmHelper.page.evaluate((name: string) => {
        const control = (window as any).Xrm.Page.getControl(name);
        if (!control) throw new Error(`Subgrid control '${name}' not found on form`);
        return control.refresh();
      }, subgridName);
    } catch (e) {
      throw new RethrownError(`Error refreshing subgrid '${subgridName}'`, e as Error);
    }
  }

  /**
   * Gets every loaded record's id from the subgrid.
   * @returns Lower-case GUIDs with no braces. Empty if the subgrid isn't found.
   */
  async getRecordIds(subgridName: string): Promise<string[]> {
    try {
      await this.xrmHelper.waitForXrmReady();

      return await this.xrmHelper.page.evaluate((name: string) => {
        const control = (window as any).Xrm.Page.getControl(name);
        if (!control) return [];

        const grid = control.getGrid();
        const rows = grid.getRows();
        const ids: string[] = [];

        for (let i = 0; i < rows.getLength(); i++) {
          const row = rows.get(i);
          const entity = row.getData().getEntity();
          const rawId = entity.getId();
          ids.push(rawId.replace(/[{}]/g, '').toLowerCase());
        }

        return ids;
      }, subgridName);
    } catch (e) {
      throw new RethrownError(`Error getting record IDs for subgrid '${subgridName}'`, e as Error);
    }
  }

  /**
   * Checks whether the subgrid control itself is visible on the form.
   */
  async isVisible(subgridName: string): Promise<boolean> {
    try {
      await this.xrmHelper.waitForXrmReady();

      return await this.xrmHelper.page.evaluate((name: string) => {
        const control = (window as any).Xrm.Page.getControl(name);
        if (!control) return false;
        return control.getVisible();
      }, subgridName);
    } catch (e) {
      throw new RethrownError(`Error checking visibility for subgrid '${subgridName}'`, e as Error);
    }
  }
}
