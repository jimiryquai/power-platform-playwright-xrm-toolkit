/**
 * Record-level Xrm Client API operations.
 *
 * @packageDocumentation
 */

import { XrmHelper } from '../../../core/xrm-helper';
import { RethrownError } from '../../../core/rethrown-error';
import {
  DialogHandler,
  DialogKind,
  DialogPolicy,
  DuplicateRecordsFoundError,
} from '../../../core/dialog-handler';

/**
 * Entity — D365 record operations via the Xrm Client API: save, refresh, and
 * record metadata (id, name, entity reference).
 *
 * Pure Xrm layer: no DOM interaction. Ribbon-button actions that mutate
 * record state through the UI (delete, activate, deactivate) belong to
 * `CommandingComponent`, which already owns command-bar buttons per ADR 0002
 * — duplicating them here against a from-scratch selector set would be a
 * second, competing way to do the same thing.
 *
 * Ported from the CCA framework per ADR 0001, replacing the overlapping
 * parts of MS's `FormComponent`.
 *
 * @example
 * ```typescript
 * const modelDrivenApp = new ModelDrivenAppPage(page);
 * const recordId = await modelDrivenApp.entity.save();
 * ```
 */
export class Entity {
  constructor(
    private xrmHelper: XrmHelper,
    private dialogHandler: DialogHandler
  ) {}

  /**
   * Sets every attribute's submit mode to "never" — prevents the "unsaved
   * data" prompt when navigating away without saving.
   */
  async noSubmit(): Promise<void> {
    try {
      await this.xrmHelper.waitForXrmReady();
      await this.xrmHelper.page.evaluate(() => {
        (window as any).Xrm.Page.getAttribute().forEach((a: any) => a.setSubmitMode('never'));
      });
    } catch (e) {
      throw new RethrownError('Error setting noSubmit on all attributes', e as Error);
    }
  }

  /**
   * Gets the ID of the currently open record (lower-case GUID, no braces).
   */
  async getId(): Promise<string> {
    try {
      await this.xrmHelper.waitForXrmReady();
      return await this.xrmHelper.page.evaluate(() => {
        const id = (window as any).Xrm.Page.data.entity.getId();
        return id.replace(/[{}]/g, '').toLowerCase();
      });
    } catch (e) {
      throw new RethrownError('Error getting record ID', e as Error);
    }
  }

  /**
   * Gets the logical name of the current entity.
   */
  async getEntityName(): Promise<string> {
    try {
      await this.xrmHelper.waitForXrmReady();
      return await this.xrmHelper.page.evaluate(() => {
        return (window as any).Xrm.Page.data.entity.getEntityName();
      });
    } catch (e) {
      throw new RethrownError('Error getting entity name', e as Error);
    }
  }

  /**
   * Gets the entity reference (id, entityType, name) of the current record.
   */
  async getEntityReference(): Promise<{ id: string; entityType: string; name: string }> {
    try {
      await this.xrmHelper.waitForXrmReady();
      return await this.xrmHelper.page.evaluate(() => {
        const ref = (window as any).Xrm.Page.data.entity.getEntityReference();
        return {
          id: ref.id.replace(/[{}]/g, '').toLowerCase(),
          entityType: ref.entityType,
          name: ref.name ?? '',
        };
      });
    } catch (e) {
      throw new RethrownError('Error getting entity reference', e as Error);
    }
  }

  /**
   * Saves the current record.
   *
   * A save can be interrupted by D365's duplicate-detection dialog, which
   * would otherwise leave `Xrm.Page.data.save()`'s promise hanging forever
   * behind the modal. `DialogHandler` races the save against that dialog —
   * see its default policy for what happens when nothing overrides it.
   *
   * @param ignoreDuplicateCheck - When duplicates are found: `true` dismisses
   * the dialog and saves anyway; `false` (default) aborts with
   * {@link DuplicateRecordsFoundError}.
   * @returns The record ID after save.
   */
  async save(ignoreDuplicateCheck = false): Promise<string> {
    const policy: DialogPolicy = {
      [DialogKind.DuplicateDetection]: ignoreDuplicateCheck ? 'proceed' : 'abort',
    };

    try {
      await this.xrmHelper.waitForXrmReady();

      await this.dialogHandler.run(async () => {
        await this.xrmHelper.page.evaluate(() => (window as any).Xrm.Page.data.save());
        await this.xrmHelper.waitForIdleness();
      }, policy);
    } catch (e) {
      if (e instanceof DuplicateRecordsFoundError) {
        throw e;
      }
      throw new RethrownError('Error saving record', e as Error);
    }

    return this.getId();
  }

  /**
   * Checks whether the record has unsaved changes.
   */
  async isDirty(): Promise<boolean> {
    try {
      await this.xrmHelper.waitForXrmReady();
      return await this.xrmHelper.page.evaluate(() => {
        return (window as any).Xrm.Page.data.entity.getIsDirty();
      });
    } catch (e) {
      throw new RethrownError('Error checking dirty state', e as Error);
    }
  }

  /**
   * Gets the primary attribute value (usually the record's name).
   */
  async getPrimaryAttributeValue(): Promise<string> {
    try {
      await this.xrmHelper.waitForXrmReady();
      return await this.xrmHelper.page.evaluate(() => {
        return (window as any).Xrm.Page.data.entity.getPrimaryAttributeValue();
      });
    } catch (e) {
      throw new RethrownError('Error getting primary attribute value', e as Error);
    }
  }

  /**
   * Checks whether the entity's data is currently valid.
   */
  async isValid(): Promise<boolean> {
    try {
      await this.xrmHelper.waitForXrmReady();
      return await this.xrmHelper.page.evaluate(() => {
        return (window as any).Xrm.Page.data.entity.isValid();
      });
    } catch (e) {
      throw new RethrownError('Error checking entity validity', e as Error);
    }
  }

  /**
   * Gets the form type: 0=Undefined, 1=Create, 2=Update, 3=ReadOnly, 4=Disabled, 6=BulkEdit.
   */
  async getFormType(): Promise<number> {
    try {
      await this.xrmHelper.waitForXrmReady();
      return await this.xrmHelper.page.evaluate(() => {
        return (window as any).Xrm.Page.ui.getFormType();
      });
    } catch (e) {
      throw new RethrownError('Error getting form type', e as Error);
    }
  }

  /**
   * Refreshes the record's data from the server.
   * @param save - Whether to save unsaved changes before refreshing.
   */
  async refresh(save = false): Promise<void> {
    try {
      await this.xrmHelper.waitForXrmReady();
      await this.xrmHelper.page.evaluate((shouldSave) => {
        return (window as any).Xrm.Page.data.refresh(shouldSave);
      }, save);
      await this.xrmHelper.waitForIdleness();
    } catch (e) {
      throw new RethrownError('Error refreshing record', e as Error);
    }
  }
}
