/**
 * Form-selector operations via `window.Xrm.Page.ui.formSelector`.
 *
 * @packageDocumentation
 */

import { XrmHelper } from '../../../core/xrm-helper';
import { RethrownError } from '../../../core/rethrown-error';

/**
 * Identifies a form by name or by id.
 */
export interface FormIdentifier {
  byName?: string;
  byId?: string;
}

/**
 * An item in the form selector.
 */
export interface FormSelectorItem {
  id?: string;
  label?: string;
}

/**
 * Form — D365 form-selector operations via `window.Xrm.Page.ui.formSelector`.
 *
 * Ported from the CCA framework per ADR 0001. This is the class that
 * replaces MS's `FormComponent` — the accessor name (`.form`) is reused for
 * it since the concepts it covers (which form is active) are what `.form`
 * suggests, and the old `FormComponent`/`form.context.ts` are retired
 * entirely in this same change.
 *
 * @example
 * ```typescript
 * const modelDrivenApp = new ModelDrivenAppPage(page);
 * await modelDrivenApp.form.switch({ byName: 'Order — Extended' });
 * ```
 */
export class Form {
  constructor(private xrmHelper: XrmHelper) {}

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
      throw new RethrownError('Error setting noSubmit on form', e as Error);
    }
  }

  /**
   * Gets the currently selected form (id and label).
   */
  async getCurrentFormSelectorItem(): Promise<FormSelectorItem> {
    try {
      await this.xrmHelper.waitForXrmReady();

      return await this.xrmHelper.page.evaluate(() => {
        const form = (window as any).Xrm.Page.ui.formSelector.getCurrentItem();
        return {
          id: form.getId(),
          label: form.getLabel(),
        };
      });
    } catch (e) {
      throw new RethrownError('Error getting current form selector item', e as Error);
    }
  }

  /**
   * Gets every form available in the form selector.
   */
  async getAvailableFormSelectorItems(): Promise<FormSelectorItem[]> {
    try {
      await this.xrmHelper.waitForXrmReady();

      return await this.xrmHelper.page.evaluate(() => {
        return (window as any).Xrm.Page.ui.formSelector.items
          .get()
          .map((i: any) => ({ id: i.getId(), label: i.getLabel() }));
      });
    } catch (e) {
      throw new RethrownError('Error getting available form selector items', e as Error);
    }
  }

  /**
   * Switches the active form on a multi-form entity.
   * @param identifier Identifies the target form by name or id.
   */
  async switch(identifier: FormIdentifier): Promise<void> {
    try {
      await this.xrmHelper.waitForXrmReady();

      if (identifier.byId) {
        await this.xrmHelper.page.evaluate((formId: string) => {
          const item = (window as any).Xrm.Page.ui.formSelector.items.get(formId);
          if (!item) throw new Error(`Form with id '${formId}' not found`);
          item.navigate();
        }, identifier.byId);
      } else if (identifier.byName) {
        await this.xrmHelper.page.evaluate((formName: string) => {
          const items = (window as any).Xrm.Page.ui.formSelector.items.get();
          const item = items.find((f: any) => f.getLabel() === formName);
          if (!item) throw new Error(`Form with name '${formName}' not found`);
          item.navigate();
        }, identifier.byName);
      } else {
        throw new Error('FormIdentifier must specify either byId or byName');
      }

      await this.xrmHelper.waitForIdleness();
    } catch (e) {
      throw new RethrownError(
        `Error switching form (${identifier.byId ? 'id: ' + identifier.byId : 'name: ' + identifier.byName})`,
        e as Error
      );
    }
  }
}
