/**
 * Field-level Xrm Client API operations.
 *
 * @packageDocumentation
 */

import { XrmHelper } from '../../../core/xrm-helper';
import { RethrownError } from '../../../core/rethrown-error';

/**
 * Behaviour when setting an attribute's value.
 */
export interface SetValueSettings {
  /** Time to wait after setting a value, for onChange handlers to settle (ms). Default: 500 */
  settleTime?: number;
  /** Set the value even if no visible, enabled control is bound to the attribute. */
  forceValue?: boolean;
}

/**
 * Attribute — D365 form field operations via `window.Xrm.Page.getAttribute()`.
 *
 * Pure Xrm layer: no DOM interaction. Ported from the CCA framework per ADR 0001,
 * replacing the overlapping parts of MS's `FormComponent`.
 *
 * @example
 * ```typescript
 * const modelDrivenApp = new ModelDrivenAppPage(page);
 * await modelDrivenApp.attribute.setValue('nwind_ordernumber', 'TEST-12345');
 * const value = await modelDrivenApp.attribute.getValue('nwind_ordernumber');
 * ```
 */
export class Attribute {
  constructor(private xrmHelper: XrmHelper) {}

  /**
   * Gets the required level of the specified attribute.
   * @returns 'none' | 'required' | 'recommended'
   */
  async getRequiredLevel(attributeName: string): Promise<string> {
    try {
      await this.xrmHelper.waitForXrmReady();
      return await this.xrmHelper.page.evaluate((attrName: string) => {
        const attr = (window as any).Xrm.Page.getAttribute(attrName);
        if (!attr) throw new Error(`Attribute '${attrName}' not found on form`);
        return attr.getRequiredLevel();
      }, attributeName);
    } catch (e) {
      throw new RethrownError(
        `Error getting required level for attribute '${attributeName}'`,
        e as Error
      );
    }
  }

  /**
   * Gets the value of the specified attribute.
   * @returns The attribute's value — a `Date` for datetime fields.
   */
  async getValue(attributeName: string): Promise<any> {
    try {
      await this.xrmHelper.waitForXrmReady();

      const [attributeType, value] = await this.xrmHelper.page.evaluate((attrName: string) => {
        const attribute = (window as any).Xrm.Page.getAttribute(attrName);
        if (!attribute) throw new Error(`Attribute '${attrName}' not found on form`);

        const type = attribute.getAttributeType();
        const rawValue = attribute.getValue();

        // Dates cross page.evaluate's JSON boundary as strings, not Date
        // instances — serialize here and reconstruct below.
        const serialized =
          type === 'datetime' && rawValue instanceof Date ? rawValue.toISOString() : rawValue;

        return [type, serialized];
      }, attributeName);

      if (attributeType === 'datetime' && typeof value === 'string') {
        return new Date(Date.parse(value));
      }

      return value;
    } catch (e) {
      throw new RethrownError(`Error getting value for attribute '${attributeName}'`, e as Error);
    }
  }

  /**
   * Sets the value of the specified attribute.
   *
   * Marks the attribute dirty and fires its onChange handlers — for a
   * commit that skips onChange (to avoid business rules that reset the
   * field), set the value directly via `page.evaluate` instead. See
   * CLAUDE.md § 9.
   *
   * @param settings - Settle time (ms) after the write, and whether to
   * force the write onto a locked/hidden control. A bare number is
   * shorthand for `{ settleTime }`.
   */
  async setValue(
    attributeName: string,
    value: any,
    settings?: number | SetValueSettings
  ): Promise<void> {
    const defaults: Required<SetValueSettings> = { settleTime: 500, forceValue: false };
    const safeSettings: Required<SetValueSettings> = {
      ...defaults,
      ...(typeof settings === 'number' ? { settleTime: settings } : settings),
    };

    try {
      const isDate = Object.prototype.toString.call(value) === '[object Date]';
      await this.xrmHelper.waitForXrmReady();

      await this.xrmHelper.page.evaluate(
        ({ attrName, val, opts }) => {
          const attribute = (window as any).Xrm.Page.getAttribute(attrName);
          if (!attribute) throw new Error(`Attribute '${attrName}' not found on form`);

          const editable =
            opts.forceValue ||
            attribute.controls.get().some((control: any) => {
              return (
                !control.getDisabled() &&
                control.getVisible() &&
                (!control.getParent() || control.getParent().getVisible()) &&
                (!control.getParent() ||
                  !control.getParent().getParent() ||
                  control.getParent().getParent().getVisible())
              );
            });

          if (!editable) {
            throw new Error(
              `Attribute '${attrName}' has no unlocked and visible control, users can't set a value like that.`
            );
          }

          // Only wrap in a Date when there is a value to wrap — new Date(null)
          // is the Unix epoch and new Date(undefined) is Invalid Date, either
          // of which would silently commit a bogus date instead of clearing
          // the field when the caller means to clear it.
          const finalValue =
            attribute.getAttributeType() === 'datetime' && val !== null && val !== undefined
              ? new Date(val)
              : val;
          attribute.setValue(finalValue);
          attribute.fireOnChange();
        },
        {
          attrName: attributeName,
          val: isDate ? (value as Date).toISOString() : value,
          opts: safeSettings,
        }
      );

      await this.xrmHelper.waitForIdleness(safeSettings.settleTime);
    } catch (e) {
      throw new RethrownError(`Error setting value for attribute '${attributeName}'`, e as Error);
    }
  }

  /**
   * Sets multiple attribute values in sequence.
   * @param values - Map of attribute name to value.
   */
  async setValues(
    values: { [key: string]: any },
    settings?: number | SetValueSettings
  ): Promise<void> {
    for (const attributeName in values) {
      await this.setValue(attributeName, values[attributeName], settings);
    }
  }

  /**
   * Gets the attribute type (e.g. 'string', 'datetime', 'lookup', 'optionset').
   */
  async getAttributeType(attributeName: string): Promise<string> {
    try {
      await this.xrmHelper.waitForXrmReady();
      return await this.xrmHelper.page.evaluate((attrName: string) => {
        const attr = (window as any).Xrm.Page.getAttribute(attrName);
        if (!attr) throw new Error(`Attribute '${attrName}' not found on form`);
        return attr.getAttributeType();
      }, attributeName);
    } catch (e) {
      throw new RethrownError(`Error getting attribute type for '${attributeName}'`, e as Error);
    }
  }

  /**
   * Gets the formatted display value of the attribute — the selected option's
   * label for an optionset, or the raw value stringified for everything else.
   *
   * The Xrm Client API has no `getFormattedValue()` of its own; `getText()`
   * (display label) exists only on `OptionSetAttribute`, so it is used when
   * present and the raw value is the fallback for every other attribute type.
   */
  async getFormattedValue(attributeName: string): Promise<string> {
    try {
      await this.xrmHelper.waitForXrmReady();
      return await this.xrmHelper.page.evaluate((attrName: string) => {
        const attribute = (window as any).Xrm.Page.getAttribute(attrName);
        if (!attribute) throw new Error(`Attribute '${attrName}' not found on form`);
        if (typeof attribute.getText === 'function') {
          return attribute.getText();
        }
        const raw = attribute.getValue();
        return raw === null || raw === undefined ? '' : String(raw);
      }, attributeName);
    } catch (e) {
      throw new RethrownError(
        `Error getting formatted value for attribute '${attributeName}'`,
        e as Error
      );
    }
  }

  /**
   * Checks whether the attribute has unsaved changes.
   */
  async isDirty(attributeName: string): Promise<boolean> {
    try {
      await this.xrmHelper.waitForXrmReady();
      return await this.xrmHelper.page.evaluate((attrName: string) => {
        const attr = (window as any).Xrm.Page.getAttribute(attrName);
        if (!attr) throw new Error(`Attribute '${attrName}' not found on form`);
        return attr.getIsDirty();
      }, attributeName);
    } catch (e) {
      throw new RethrownError(
        `Error checking dirty state for attribute '${attributeName}'`,
        e as Error
      );
    }
  }

  /**
   * Sets the required level of the attribute.
   */
  async setRequiredLevel(
    attributeName: string,
    requirementLevel: 'none' | 'required' | 'recommended'
  ): Promise<void> {
    try {
      await this.xrmHelper.waitForXrmReady();
      await this.xrmHelper.page.evaluate(
        ({ attrName, level }) => {
          const attr = (window as any).Xrm.Page.getAttribute(attrName);
          if (!attr) throw new Error(`Attribute '${attrName}' not found on form`);
          attr.setRequiredLevel(level);
        },
        { attrName: attributeName, level: requirementLevel }
      );
    } catch (e) {
      throw new RethrownError(
        `Error setting required level for attribute '${attributeName}'`,
        e as Error
      );
    }
  }
}
