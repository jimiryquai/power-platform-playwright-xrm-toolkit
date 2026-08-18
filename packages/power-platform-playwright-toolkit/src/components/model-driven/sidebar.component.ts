/**
 * Sidebar — D365 app sidebar (navigation tree, pinned/recent items, area switcher).
 *
 * Shell layer: DOM-based Playwright locators for the D365 site-map navigation.
 * Ported from the CCA framework's `Sidebar.ts` per ADR 0002 — a pure capability
 * gain, since MS's toolkit has no dedicated Sidebar component (only the two ad
 * hoc `navigateToRuntimeItem`/`expandNavigationGroup` methods on
 * `ModelDrivenAppPage`).
 *
 * @packageDocumentation
 */

import type { Page } from '@playwright/test';
import { ModelDrivenAppLocators } from '../../locators/model-driven-app.locators';
import { RethrownError } from '../../core/rethrown-error';
import {
  DialogHandler,
  DialogKind,
  DialogPolicy,
  DialogResponse,
} from '../../core/dialog-handler';

/**
 * Behaviour when leaving a dirty form raises D365's "unsaved changes" prompt.
 */
export interface SidebarNavigationSettings {
  /**
   * How to respond if navigating away raises the "unsaved changes" dialog.
   * Default (unset): `DialogHandler`'s own default for
   * {@link DialogKind.UnsavedChanges} — `'proceed'`, discarding the changes
   * and completing the navigation.
   */
  onUnsavedChanges?: DialogResponse;
}

const S = ModelDrivenAppLocators.Runtime.SiteMap;

/**
 * Sidebar — D365 site-map navigation: sub-areas, the Recent/Pinned menus, and
 * the area switcher.
 *
 * @example
 * ```typescript
 * const modelDrivenApp = new ModelDrivenAppPage(page);
 * await modelDrivenApp.sidebar.navigate('Accounts');
 * const area = await modelDrivenApp.sidebar.getCurrentArea();
 * ```
 */
export class Sidebar {
  constructor(
    private page: Page,
    private dialogHandler: DialogHandler
  ) {}

  private policyFor(settings?: SidebarNavigationSettings): DialogPolicy {
    return settings?.onUnsavedChanges
      ? { [DialogKind.UnsavedChanges]: settings.onUnsavedChanges }
      : {};
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  /** Navigate to a sidebar item by its aria-label (e.g. 'Accounts', 'Home'). */
  async navigate(ariaLabel: string, settings?: SidebarNavigationSettings): Promise<void> {
    try {
      const locator = S.TreeItemByAriaLabel(this.page, ariaLabel);
      await locator.waitFor({ state: 'visible' });

      await this.dialogHandler.run(
        () => locator.click(),
        this.policyFor(settings)
      );
    } catch (e) {
      throw new RethrownError(`Error navigating to sidebar item '${ariaLabel}'`, e as Error);
    }
  }

  /** Get the currently active sub-area's display name. */
  async getCurrentSubArea(): Promise<string> {
    try {
      const dataText = await S.ActiveTreeItem(this.page).getAttribute('data-text');
      return dataText || '';
    } catch (e) {
      throw new RethrownError('Error getting current sub-area', e as Error);
    }
  }

  /** Check whether a sub-area (matched by its display text) is currently selected. */
  async isSubAreaActive(subAreaName: string): Promise<boolean> {
    try {
      const isSelected = await S.TreeItemByText(this.page, subAreaName).getAttribute(
        'aria-selected'
      );
      return isSelected === 'true';
    } catch (e) {
      throw new RethrownError(`Error checking whether '${subAreaName}' is active`, e as Error);
    }
  }

  // ── Expandable menus (Recent / Pinned) ──────────────────────────────────────

  /** Expand a collapsible menu section (e.g. 'Recent', 'Pinned'). */
  async expandMenu(menuLabel: string): Promise<void> {
    try {
      const menu = S.TreeItemByAriaLabel(this.page, menuLabel);
      const isExpanded = await menu.getAttribute('aria-expanded');
      if (isExpanded === 'false') {
        const expandButton = S.TreeItemExpandButton(menu);
        await expandButton.waitFor({ state: 'visible' });
        await expandButton.click();
        await menu.waitFor({ state: 'attached' });
      }
    } catch (e) {
      throw new RethrownError(`Error expanding menu '${menuLabel}'`, e as Error);
    }
  }

  /** Collapse a collapsible menu section (e.g. 'Recent', 'Pinned'). */
  async collapseMenu(menuLabel: string): Promise<void> {
    try {
      const menu = S.TreeItemByAriaLabel(this.page, menuLabel);
      const isExpanded = await menu.getAttribute('aria-expanded');
      if (isExpanded === 'true') {
        const collapseButton = S.TreeItemExpandButton(menu);
        await collapseButton.click();
      }
    } catch (e) {
      throw new RethrownError(`Error collapsing menu '${menuLabel}'`, e as Error);
    }
  }

  /** Check whether a collapsible menu section (e.g. 'Recent', 'Pinned') is expanded. */
  async isMenuExpanded(menuLabel: string): Promise<boolean> {
    try {
      const expandedState = await S.TreeItemByAriaLabel(this.page, menuLabel).getAttribute(
        'aria-expanded'
      );
      return expandedState === 'true';
    } catch (e) {
      throw new RethrownError(`Error checking whether menu '${menuLabel}' is expanded`, e as Error);
    }
  }

  // ── Recent items ─────────────────────────────────────────────────────────

  /** Get the display names of every item currently in the Recent menu. */
  async getRecentItems(): Promise<string[]> {
    try {
      await this.expandMenu('Recent');
      return S.RecentItemList(this.page).evaluateAll((elements) =>
        elements
          .map((el) => el.getAttribute('data-text'))
          .filter((text): text is string => Boolean(text))
      );
    } catch (e) {
      throw new RethrownError('Error getting recent items', e as Error);
    }
  }

  /** Click a recent item by its display name. */
  async clickRecentItem(itemName: string): Promise<void> {
    try {
      await this.expandMenu('Recent');
      await S.RecentItem(this.page, itemName).click();
    } catch (e) {
      throw new RethrownError(`Error clicking recent item '${itemName}'`, e as Error);
    }
  }

  /** Pin a recent item — hovers to reveal the pin button, then clicks it. */
  async pinRecentItem(itemName: string): Promise<void> {
    try {
      await this.expandMenu('Recent');
      const item = S.RecentItem(this.page, itemName).first();
      await item.hover();

      const pinButton = S.PinButton(item);
      await pinButton.waitFor({ state: 'visible' });
      await pinButton.click();

      await S.PinnedItem(this.page, itemName).waitFor({ state: 'visible', timeout: 5000 });
    } catch (e) {
      throw new RethrownError(`Error pinning recent item '${itemName}'`, e as Error);
    }
  }

  // ── Pinned items ─────────────────────────────────────────────────────────

  /** Get the display names of every item currently in the Pinned menu. */
  async getPinnedItems(): Promise<string[]> {
    try {
      await this.expandMenu('Pinned');
      return S.PinnedItemList(this.page).evaluateAll((elements) =>
        elements
          .map((el) => el.getAttribute('data-text'))
          .filter((text): text is string => Boolean(text))
      );
    } catch (e) {
      throw new RethrownError('Error getting pinned items', e as Error);
    }
  }

  /** Click a pinned item by its display name. */
  async clickPinnedItem(itemName: string): Promise<void> {
    try {
      await this.expandMenu('Pinned');
      await S.PinnedItem(this.page, itemName).click();
    } catch (e) {
      throw new RethrownError(`Error clicking pinned item '${itemName}'`, e as Error);
    }
  }

  /** Unpin an item — hovers to reveal the unpin button, then clicks it. */
  async unpinItem(itemName: string): Promise<void> {
    try {
      await this.expandMenu('Pinned');
      const item = S.PinnedItem(this.page, itemName).first();
      await item.hover();

      const unpinButton = S.UnpinButton(item);
      await unpinButton.click();

      await S.PinnedItem(this.page, itemName).waitFor({ state: 'detached', timeout: 5000 });
    } catch (e) {
      throw new RethrownError(`Error unpinning item '${itemName}'`, e as Error);
    }
  }

  // ── Area switcher ────────────────────────────────────────────────────────

  /** Get the current area's display name. */
  async getCurrentArea(): Promise<string> {
    try {
      const areaText = (await S.AreaSwitcher(this.page).textContent()) || '';
      return this.cleanAreaName(areaText);
    } catch (e) {
      throw new RethrownError('Error getting current area', e as Error);
    }
  }

  /** Get every area name available in the switcher flyout. */
  async getAvailableAreas(): Promise<string[]> {
    try {
      await S.AreaSwitcher(this.page).click();
      await S.AreaSwitcherFlyout(this.page).waitFor({ state: 'attached' });

      const allText = (await S.AreaSwitcherFlyout(this.page).textContent()) || '';
      const areasText = allText.replace(/^Change area/, '');
      const areas = areasText.split(/(?<=[a-z])(?=[A-Z])/).filter((a) => a.trim());

      await this.page.keyboard.press('Escape');
      return areas.map((a) => this.cleanAreaName(a));
    } catch (e) {
      throw new RethrownError('Error getting available areas', e as Error);
    }
  }

  /** Switch to a different area via the area switcher flyout. */
  async changeArea(areaName: string, settings?: SidebarNavigationSettings): Promise<void> {
    try {
      await S.AreaSwitcher(this.page).click();
      const flyout = S.AreaSwitcherFlyout(this.page);
      await flyout.waitFor({ state: 'attached' });
      const option = S.AreaOption(flyout, areaName);

      await this.dialogHandler.run(() => option.click(), this.policyFor(settings));
    } catch (e) {
      throw new RethrownError(`Error changing area to '${areaName}'`, e as Error);
    }
  }

  // ── Groups ───────────────────────────────────────────────────────────────

  /** Get every group header name in the current area. */
  async getGroupsInCurrentArea(): Promise<string[]> {
    try {
      return S.GroupHeaderList(this.page).evaluateAll((elements) =>
        elements
          .map((el) => el.textContent?.trim())
          .filter((text): text is string => Boolean(text))
      );
    } catch (e) {
      throw new RethrownError('Error getting groups in current area', e as Error);
    }
  }

  /** Get every sub-area's display name within a specific group. */
  async getSubAreasInGroup(groupName: string): Promise<string[]> {
    try {
      const subAreas = this.page
        .locator(`h3:has-text("${groupName}")`)
        .locator('+ ul')
        .locator('li[data-text]');

      return subAreas.evaluateAll((elements) =>
        elements
          .map((el) => el.getAttribute('data-text'))
          .filter((text): text is string => Boolean(text))
      );
    } catch (e) {
      throw new RethrownError(`Error getting sub-areas in group '${groupName}'`, e as Error);
    }
  }

  // ── Wait / ready ─────────────────────────────────────────────────────────

  /** Wait for the sidebar's navigation, Recent, and Pinned items to load. */
  async waitForLoaded(): Promise<void> {
    try {
      await S.TreeItemByAriaLabel(this.page, 'Home').waitFor({
        state: 'visible',
        timeout: 120000,
      });
      await S.TreeItemByAriaLabel(this.page, 'Recent').waitFor({
        state: 'visible',
        timeout: 60000,
      });
      await S.TreeItemByAriaLabel(this.page, 'Pinned').waitFor({
        state: 'visible',
        timeout: 60000,
      });
    } catch (e) {
      throw new RethrownError('Error waiting for sidebar to load', e as Error);
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private cleanAreaName(areaText: string): string {
    return areaText
      .trim()
      .replace(/^[A-Z]{2}(?=[A-Z][a-z])/, '')
      .trim();
  }
}
