/**
 * Form tab operations via `window.Xrm.Page.ui.tabs`.
 *
 * @packageDocumentation
 */

import { XrmHelper } from '../../../core/xrm-helper';
import { RethrownError } from '../../../core/rethrown-error';

/**
 * State of a tab.
 */
export interface TabState {
  /** Whether the tab is visible. */
  isVisible: boolean;
}

/**
 * Tab — D365 form tab operations via `window.Xrm.Page.ui.tabs`.
 *
 * Pure Xrm layer: no DOM interaction. Ported from the CCA framework per
 * ADR 0001.
 *
 * @example
 * ```typescript
 * const modelDrivenApp = new ModelDrivenAppPage(page);
 * await modelDrivenApp.tab.open('SUMMARY_TAB');
 * const state = await modelDrivenApp.tab.get('SUMMARY_TAB');
 * ```
 */
export class Tab {
  constructor(private xrmHelper: XrmHelper) {}

  /**
   * Expands (opens) the specified tab.
   */
  async open(tabName: string): Promise<void> {
    try {
      await this.xrmHelper.waitForXrmReady();

      await this.xrmHelper.page.evaluate((name: string) => {
        const tab = (window as any).Xrm.Page.ui.tabs.get(name);
        if (!tab) throw new Error(`Tab '${name}' not found on form`);
        tab.setDisplayState('expanded');
      }, tabName);

      await this.xrmHelper.waitForIdleness();
    } catch (e) {
      throw new RethrownError(`Error opening tab '${tabName}'`, e as Error);
    }
  }

  /**
   * Collapses (closes) the specified tab.
   */
  async close(tabName: string): Promise<void> {
    try {
      await this.xrmHelper.waitForXrmReady();

      await this.xrmHelper.page.evaluate((name: string) => {
        const tab = (window as any).Xrm.Page.ui.tabs.get(name);
        if (!tab) throw new Error(`Tab '${name}' not found on form`);
        tab.setDisplayState('collapsed');
      }, tabName);
    } catch (e) {
      throw new RethrownError(`Error closing tab '${tabName}'`, e as Error);
    }
  }

  /**
   * Gets the state of the specified tab.
   */
  async get(tabName: string): Promise<TabState> {
    try {
      await this.xrmHelper.waitForXrmReady();

      return await this.xrmHelper.page.evaluate((name: string) => {
        const tab = (window as any).Xrm.Page.ui.tabs.get(name);
        if (!tab) throw new Error(`Tab '${name}' not found on form`);
        return { isVisible: tab.getVisible() };
      }, tabName);
    } catch (e) {
      throw new RethrownError(`Error getting tab '${tabName}'`, e as Error);
    }
  }

  /**
   * Gets every tab on the current form, with its name and visibility.
   */
  async getAll(): Promise<Array<{ name: string; isVisible: boolean }>> {
    try {
      await this.xrmHelper.waitForXrmReady();

      return await this.xrmHelper.page.evaluate(() => {
        const tabs: Array<{ name: string; isVisible: boolean }> = [];
        (window as any).Xrm.Page.ui.tabs.forEach((tab: any) => {
          tabs.push({
            name: tab.getName(),
            isVisible: tab.getVisible(),
          });
        });
        return tabs;
      });
    } catch (e) {
      throw new RethrownError('Error getting all tabs', e as Error);
    }
  }
}
