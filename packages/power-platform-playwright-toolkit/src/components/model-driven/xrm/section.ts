/**
 * Form section operations via `window.Xrm.Page.ui.tabs.get().sections`.
 *
 * @packageDocumentation
 */

import { XrmHelper } from '../../../core/xrm-helper';
import { RethrownError } from '../../../core/rethrown-error';

/**
 * State of a section.
 */
export interface SectionState {
  /** Whether the section is visible — also considers the parent tab's visibility. */
  isVisible: boolean;
}

/**
 * Section — D365 form section operations via
 * `window.Xrm.Page.ui.tabs.get().sections`.
 *
 * Pure Xrm layer: no DOM interaction. Ported from the CCA framework per
 * ADR 0001. Sections have no expand/collapse concept in the Xrm client API
 * (unlike tabs, which do — see {@link Tab.open}/{@link Tab.close}) — only
 * visibility, which `setVisible` below adds. CCA's original port only read
 * section state; this toolkit's #25 acceptance criteria calls for changing
 * it too.
 *
 * @example
 * ```typescript
 * const modelDrivenApp = new ModelDrivenAppPage(page);
 * await modelDrivenApp.section.setVisible('SUMMARY_TAB', 'ACCOUNT_INFO', false);
 * const state = await modelDrivenApp.section.get('SUMMARY_TAB', 'ACCOUNT_INFO');
 * ```
 */
export class Section {
  constructor(private xrmHelper: XrmHelper) {}

  /**
   * Gets the state of the specified section.
   * @param tabName Name of the parent tab.
   * @param sectionName Name of the section.
   */
  async get(tabName: string, sectionName: string): Promise<SectionState> {
    try {
      await this.xrmHelper.waitForXrmReady();

      return await this.xrmHelper.page.evaluate(
        ({ tab, section }) => {
          const tabControl = (window as any).Xrm.Page.ui.tabs.get(tab);
          if (!tabControl) throw new Error(`Tab '${tab}' not found on form`);

          const sectionControl = tabControl.sections.get(section);
          if (!sectionControl) {
            throw new Error(`Section '${section}' not found in tab '${tab}'`);
          }

          return {
            isVisible: sectionControl.getVisible() && tabControl.getVisible(),
          };
        },
        { tab: tabName, section: sectionName }
      );
    } catch (e) {
      throw new RethrownError(
        `Error getting section '${sectionName}' in tab '${tabName}'`,
        e as Error
      );
    }
  }

  /**
   * Sets the visibility of the specified section.
   * @param tabName Name of the parent tab.
   * @param sectionName Name of the section.
   * @param visible Whether the section should be visible.
   */
  async setVisible(tabName: string, sectionName: string, visible: boolean): Promise<void> {
    try {
      await this.xrmHelper.waitForXrmReady();

      await this.xrmHelper.page.evaluate(
        ({ tab, section, isVisible }) => {
          const tabControl = (window as any).Xrm.Page.ui.tabs.get(tab);
          if (!tabControl) throw new Error(`Tab '${tab}' not found on form`);

          const sectionControl = tabControl.sections.get(section);
          if (!sectionControl) {
            throw new Error(`Section '${section}' not found in tab '${tab}'`);
          }

          sectionControl.setVisible(isVisible);
        },
        { tab: tabName, section: sectionName, isVisible: visible }
      );
    } catch (e) {
      throw new RethrownError(
        `Error setting visibility for section '${sectionName}' in tab '${tabName}'`,
        e as Error
      );
    }
  }
}
