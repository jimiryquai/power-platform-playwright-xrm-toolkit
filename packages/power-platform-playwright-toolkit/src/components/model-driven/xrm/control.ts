/**
 * Form control operations via `window.Xrm.Page.getControl()`.
 *
 * @packageDocumentation
 */

import { XrmHelper } from '../../../core/xrm-helper';
import { RethrownError } from '../../../core/rethrown-error';

/**
 * State of a control.
 */
export interface ControlState {
  /** Whether the control is visible, considering parent section/tab visibility. */
  isVisible: boolean;
  /** Whether the control is disabled. */
  isDisabled: boolean;
}

/**
 * Control — D365 form control operations via `window.Xrm.Page.getControl()`.
 *
 * Pure Xrm layer: no DOM interaction. Ported from the CCA framework per
 * ADR 0001.
 *
 * @example
 * ```typescript
 * const modelDrivenApp = new ModelDrivenAppPage(page);
 * await modelDrivenApp.control.setVisible('nwind_ordernumber', false);
 * const state = await modelDrivenApp.control.get('nwind_ordernumber');
 * ```
 */
export class Control {
  constructor(private xrmHelper: XrmHelper) {}

  /**
   * Gets the state of the specified control.
   * @returns Visibility (considering parent section/tab) and disabled state.
   */
  async get(controlName: string): Promise<ControlState> {
    try {
      await this.xrmHelper.waitForXrmReady();

      return await this.xrmHelper.page.evaluate((name: string) => {
        const control = (window as any).Xrm.Page.getControl(name);
        if (!control) throw new Error(`Control '${name}' not found on form`);

        const isVisible =
          control.getVisible() &&
          (!control.getParent() || control.getParent().getVisible()) &&
          (!control.getParent() ||
            !control.getParent().getParent() ||
            control.getParent().getParent().getVisible());

        return {
          isVisible,
          isDisabled: control.getDisabled(),
        };
      }, controlName);
    } catch (e) {
      throw new RethrownError(`Error getting control '${controlName}'`, e as Error);
    }
  }

  /**
   * Gets the available options of an option set control.
   */
  async getOptions(controlName: string): Promise<Array<{ text: string; value: number }>> {
    try {
      await this.xrmHelper.waitForXrmReady();

      return await this.xrmHelper.page.evaluate((name: string) => {
        const control = (window as any).Xrm.Page.getControl(name);
        if (!control) throw new Error(`Control '${name}' not found on form`);
        return control.getOptions();
      }, controlName);
    } catch (e) {
      throw new RethrownError(`Error getting options for control '${controlName}'`, e as Error);
    }
  }

  /**
   * Sets the visibility of the specified control.
   */
  async setVisible(controlName: string, visible: boolean): Promise<void> {
    try {
      await this.xrmHelper.waitForXrmReady();

      await this.xrmHelper.page.evaluate(
        ({ name, isVisible }) => {
          const control = (window as any).Xrm.Page.getControl(name);
          if (!control) throw new Error(`Control '${name}' not found on form`);
          control.setVisible(isVisible);
        },
        { name: controlName, isVisible: visible }
      );
    } catch (e) {
      throw new RethrownError(`Error setting visibility for control '${controlName}'`, e as Error);
    }
  }

  /**
   * Sets the disabled state of the specified control.
   */
  async setDisabled(controlName: string, disabled: boolean): Promise<void> {
    try {
      await this.xrmHelper.waitForXrmReady();

      await this.xrmHelper.page.evaluate(
        ({ name, isDisabled }) => {
          const control = (window as any).Xrm.Page.getControl(name);
          if (!control) throw new Error(`Control '${name}' not found on form`);
          control.setDisabled(isDisabled);
        },
        { name: controlName, isDisabled: disabled }
      );
    } catch (e) {
      throw new RethrownError(
        `Error setting disabled state for control '${controlName}'`,
        e as Error
      );
    }
  }

  /**
   * Gets the label of the specified control.
   */
  async getLabel(controlName: string): Promise<string> {
    try {
      await this.xrmHelper.waitForXrmReady();

      return await this.xrmHelper.page.evaluate((name: string) => {
        const control = (window as any).Xrm.Page.getControl(name);
        if (!control) throw new Error(`Control '${name}' not found on form`);
        return control.getLabel();
      }, controlName);
    } catch (e) {
      throw new RethrownError(`Error getting label for control '${controlName}'`, e as Error);
    }
  }

  /**
   * Sets the label of the specified control.
   */
  async setLabel(controlName: string, label: string): Promise<void> {
    try {
      await this.xrmHelper.waitForXrmReady();

      await this.xrmHelper.page.evaluate(
        ({ name, labelText }) => {
          const control = (window as any).Xrm.Page.getControl(name);
          if (!control) throw new Error(`Control '${name}' not found on form`);
          control.setLabel(labelText);
        },
        { name: controlName, labelText: label }
      );
    } catch (e) {
      throw new RethrownError(`Error setting label for control '${controlName}'`, e as Error);
    }
  }
}
