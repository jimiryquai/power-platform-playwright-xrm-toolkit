// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * GridComponent
 * Handles all grid/list view operations for Model-Driven Apps
 *
 * @example
 * ```typescript
 * const modelDrivenApp = new ModelDrivenAppPage(page);
 *
 * // Open first record
 * await modelDrivenApp.grid.openRecord({ rowNumber: 0 });
 *
 * // Get cell value
 * const orderNumber = await modelDrivenApp.grid.getCellValue(0, 'Order Number');
 *
 * // Select row
 * await modelDrivenApp.grid.selectRow(0);
 * ```
 */

import { Page, Locator, expect } from '@playwright/test';
import { GridRecordOptions } from './types';
import { RethrownError } from '../../core/rethrown-error';

export class GridComponent {
  constructor(
    private page: Page,
    private gridLocators: any // ModelDrivenAppLocators.Runtime.Content.Grid
  ) {}

  /**
   * Open a record from the grid
   * Supports opening by row number or by searching for column value
   *
   * @param options - Record selection options
   *
   * @example
   * ```typescript
   * // Open first record
   * await grid.openRecord({ rowNumber: 0 });
   *
   * // Open record by column value
   * await grid.openRecord({
   *   columnValue: 'TEST-123',
   *   columnName: 'Order Number'
   * });
   * ```
   */
  async openRecord(options: GridRecordOptions): Promise<void> {
    try {
      if (options.rowNumber !== undefined) {
        await this.openRecordByRowNumber(options.rowNumber);
      } else if (options.columnValue && options.columnName) {
        await this.openRecordByColumnValue(options.columnName, options.columnValue);
      } else {
        throw new Error('Must provide either rowNumber or (columnValue + columnName)');
      }
    } catch (e) {
      throw new RethrownError('Error opening record from grid', e as Error);
    }
  }

  /**
   * Open record by clicking row at specific index
   * Uses multiple fallback strategies: link click, double-click, context menu
   */
  private async openRecordByRowNumber(rowNumber: number): Promise<void> {
    const row = this.gridLocators.RowByIndex(this.page, rowNumber);
    await row.waitFor({ state: 'visible', timeout: 30000 });

    // Strategy 1: Try clicking link in first cell
    try {
      const link = this.gridLocators.LinkCell(row).first();
      await link.click({ timeout: 5000 });
      console.log(`[GridComponent] Opened record via link click`);
      return;
    } catch {
      console.log('[GridComponent] Link click failed, trying double-click');
    }

    // Strategy 2: Try double-clicking row
    try {
      await row.dblclick({ timeout: 5000 });
      console.log(`[GridComponent] Opened record via double-click`);
      return;
    } catch {
      throw new Error(`Failed to open record at row ${rowNumber}`);
    }
  }

  /**
   * Open record by finding row with matching column value
   */
  private async openRecordByColumnValue(columnName: string, value: string): Promise<void> {
    const rowCount = await this.getRowCount();

    for (let i = 0; i < rowCount; i++) {
      const cellValue = await this.getCellValue(i, columnName);
      if (cellValue.includes(value)) {
        await this.openRecordByRowNumber(i);
        return;
      }
    }

    throw new Error(`Record not found with ${columnName}="${value}"`);
  }

  /**
   * Select a single row by index
   * Uses checkbox selection if available, otherwise clicks row
   *
   * @param rowNumber - Row index (0-based)
   */
  async selectRow(rowNumber: number): Promise<void> {
    try {
      const row = this.gridLocators.RowByIndex(this.page, rowNumber);
      await row.waitFor({ state: 'visible', timeout: 30000 });

      // Try checkbox selection first
      const checkbox = this.gridLocators.CheckboxCell(row);
      const hasCheckbox = await checkbox.isVisible().catch(() => false);

      if (hasCheckbox) {
        // force: true bypasses overlay elements (e.g. CheckMark icon) that intercept pointer events
        await checkbox.click({ force: true });
        console.log(`[GridComponent] Selected row ${rowNumber} via checkbox`);
      } else {
        await row.click();
        console.log(`[GridComponent] Selected row ${rowNumber} via click`);
      }
    } catch (e) {
      throw new RethrownError(`Error selecting row ${rowNumber}`, e as Error);
    }
  }

  /**
   * Select multiple rows
   *
   * @param rowNumbers - Array of row indices to select
   */
  async selectRows(rowNumbers: number[]): Promise<void> {
    for (const rowNumber of rowNumbers) {
      await this.selectRow(rowNumber);
    }
  }

  /**
   * Get cell value at specific row and column
   *
   * Uses ag-Grid's `row-index` and `col-id` attributes for reliable targeting,
   * avoiding fragile positional nth-child selectors.
   *
   * @param row - Row index (0-based, matches ag-Grid row-index attribute)
   * @param column - Column schema name (col-id, e.g. 'nwind_ordernumber') or display name
   * @returns Cell text content
   */
  async getCellValue(row: number, column: string): Promise<string> {
    try {
      // Try direct col-id match first (schema name e.g. 'nwind_ordernumber')
      let cell = this.page.locator(
        `[role="row"][row-index="${row}"] [role="gridcell"][col-id="${column}"]`
      );

      if ((await cell.count()) === 0) {
        // Fall back: resolve col-id from display name by scanning column headers
        const colId = await this.getColIdByDisplayName(column);
        cell = this.page.locator(
          `[role="row"][row-index="${row}"] [role="gridcell"][col-id="${colId}"]`
        );
      }

      await cell.waitFor({ state: 'visible', timeout: 10000 });

      // Prefer aria-label on inner link — most reliable in MDA ag-Grid
      const link = cell.locator('a[aria-label]').first();
      if ((await link.count()) > 0) {
        return (await link.getAttribute('aria-label')) ?? '';
      }

      return (await cell.textContent())?.trim() ?? '';
    } catch (e) {
      throw new RethrownError(`Error getting cell value at row ${row}, column "${column}"`, e as Error);
    }
  }

  /**
   * Resolve a column's col-id by matching display name against column headers
   */
  private async getColIdByDisplayName(displayName: string): Promise<string> {
    const headers = this.page.locator('[role="columnheader"][col-id]');
    const count = await headers.count();

    for (let i = 0; i < count; i++) {
      const header = headers.nth(i);
      const ariaLabel = await header.getAttribute('aria-label');
      const text = (await header.textContent())?.trim() ?? '';

      if ((ariaLabel && ariaLabel.includes(displayName)) || text.includes(displayName)) {
        return (await header.getAttribute('col-id')) ?? '';
      }
    }

    throw new Error(`Column "${displayName}" not found in grid`);
  }

  /**
   * Get total number of rows in the grid (excluding header)
   *
   * @returns Number of data rows
   */
  async getRowCount(): Promise<number> {
    try {
      // Count only data rows (those with a row-index attribute); header rows have no row-index.
      const dataRows = this.page.locator('[role="row"][row-index]');
      return await dataRows.count();
    } catch (e) {
      throw new RethrownError('Error getting grid row count', e as Error);
    }
  }

  /**
   * Sort grid by column
   *
   * @param columnName - Column name to sort by
   * @param direction - Sort direction ('asc' or 'desc')
   */
  async sortByColumn(columnName: string, direction: 'asc' | 'desc' = 'asc'): Promise<void> {
    try {
      const header = this.gridLocators.ColumnHeader(this.page, columnName);
      await header.waitFor({ state: 'visible', timeout: 10000 });

      // Check current sort state
      const ariaSort = await header.getAttribute('aria-sort');
      const alreadySorted =
        (direction === 'asc' && ariaSort === 'ascending') ||
        (direction === 'desc' && ariaSort === 'descending');

      // ag-Grid column headers toggle asc <-> desc on each click, so a single
      // click flips directly to the desired direction from either other state —
      // a second click would overshoot back past it (see #26's known-defect note).
      if (!alreadySorted) {
        await header.click();
      }

      // Wait for grid to re-render after sort — the loading indicator appears
      // briefly while ag-Grid re-orders rows; wait for it to clear.
      await this.waitForGridLoad();
      console.log(`[GridComponent] Sorted by ${columnName} ${direction}`);
    } catch (e) {
      throw new RethrownError(`Error sorting by column "${columnName}" (${direction})`, e as Error);
    }
  }

  /**
   * Wait for grid to fully load
   * Waits for grid container to be visible and loading indicator to disappear
   */
  async waitForGridLoad(): Promise<void> {
    try {
      const grid = this.gridLocators.Container(this.page);
      await grid.waitFor({ state: 'visible', timeout: 60000 });

      // Wait for loading indicator to disappear
      const loadingIndicator = this.gridLocators.LoadingIndicator(this.page);
      await loadingIndicator.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {
        console.log('[GridComponent] Loading indicator not found or already hidden');
      });

      console.log('[GridComponent] Grid loaded');
    } catch (e) {
      throw new RethrownError('Error waiting for grid to load', e as Error);
    }
  }

  /**
   * Check if grid is empty (has no data rows)
   *
   * @returns true if grid has no records
   */
  async isGridEmpty(): Promise<boolean> {
    const rowCount = await this.getRowCount();
    return rowCount === 0;
  }

  /**
   * Filter grid by a specific column using the column-level "begins with" filter.
   *
   * This uses the column header filter panel in Model-Driven App ag-Grid views.
   * Clicking the column's filter searchbox opens a "begins with" input which
   * is then filled and submitted.
   *
   * @param columnLabel - Column label as it appears in the filter searchbox
   *   (e.g. `'Order'` for the aria-label `"Order Filter by keyword"`)
   * @param value - Value to filter by
   *
   * @example
   * ```typescript
   * // Filter orders list to rows where order number begins with "0915"
   * await grid.filterByColumn('Order', '0915');
   * ```
   */
  async filterByColumn(columnLabel: string, value: string): Promise<void> {
    try {
      // Click the column-level filter searchbox, e.g. aria-label "Order Filter by keyword"
      const columnFilter = this.page.getByRole('searchbox', {
        name: `${columnLabel} Filter by keyword`,
      });
      await columnFilter.waitFor({ state: 'visible', timeout: 10000 });
      await columnFilter.click();

      // The "begins with" input that appears after clicking the column filter
      const beginsWithInput = this.page.getByRole('searchbox', {
        name: /Apply begins with filter on/i,
      });
      await beginsWithInput.waitFor({ state: 'visible', timeout: 5000 });
      await beginsWithInput.fill(value);
      await beginsWithInput.press('Enter');

      // Wait for the grid to finish re-rendering after the filter is applied.
      // waitForGridLoad() waits for the loading indicator to disappear, which works
      // for both non-empty results and empty (zero-row) results.
      await this.waitForGridLoad();
      console.log(`[GridComponent] Filtered column "${columnLabel}" begins with: "${value}"`);
    } catch (e) {
      throw new RethrownError(`Error filtering column "${columnLabel}" by "${value}"`, e as Error);
    }
  }

  /**
   * Filter grid by keyword using the search box
   * Uses the "Filter by keyword" search box in the grid toolbar
   *
   * @param keyword - The keyword to search for
   */
  async filterByKeyword(keyword: string): Promise<void> {
    try {
      // Find the filter by keyword search box.
      // data-id="quickFind-text-editor" is the stable UCI identifier; aria-label / placeholder
      // variants cover older versions.
      const searchBox = this.page.locator(
        'input[data-id="quickFind-text-editor"], input[aria-label*="Filter by keyword"], input[placeholder*="Filter by keyword"]'
      );
      await searchBox.waitFor({ state: 'visible', timeout: 30000 });

      // Clear any existing search text
      await searchBox.clear();

      // Type the keyword
      await searchBox.fill(keyword);

      // Press Enter to trigger the search
      await searchBox.press('Enter');

      // Wait for the grid to finish re-rendering. waitForGridLoad() waits for the
      // loading indicator to disappear, which covers both non-empty and empty results.
      await this.waitForGridLoad();

      console.log(`[GridComponent] Filtered by keyword: "${keyword}"`);
    } catch (e) {
      throw new RethrownError(`Error filtering by keyword "${keyword}"`, e as Error);
    }
  }

  /**
   * Get the grid locator
   * Low-level method for custom operations
   *
   * @returns Grid container locator
   */
  getGrid(): Locator {
    return this.gridLocators.Container(this.page);
  }

  // ========================================
  // Checkbox Selection
  // Ported from CCA's Grid.ts per ADR 0002
  // ========================================

  /**
   * Select every record in the grid via the header "select all" checkbox.
   */
  async selectAllRecords(): Promise<void> {
    try {
      await this.waitForGridLoad();
      const checkbox = await this.findVisibleCandidate(
        this.gridLocators.CheckboxSelectAllCandidates(this.page)
      );
      if (!checkbox) throw new Error('Select-all checkbox not found or not visible');
      await checkbox.click({ force: true });
      await this.gridLocators.SelectedRow(this.page).first().waitFor({ state: 'attached' });
    } catch (e) {
      throw new RethrownError('Error selecting all records', e as Error);
    }
  }

  /**
   * Deselect every record, if any are currently selected.
   */
  async deselectAllRecords(): Promise<void> {
    try {
      if (!(await this.areAllRecordsSelected())) return;

      await this.waitForGridLoad();
      const checkbox = await this.findVisibleCandidate(
        this.gridLocators.CheckboxSelectAllCandidates(this.page)
      );
      if (!checkbox) throw new Error('Select-all checkbox not found or not visible');
      await checkbox.click({ force: true });
      // Reuses the SelectedRow locator (also used by selectAllRecords) rather than
      // duplicating its selector string in a page.waitForFunction.
      await expect(this.gridLocators.SelectedRow(this.page)).toHaveCount(0, { timeout: 10000 });
    } catch (e) {
      throw new RethrownError('Error deselecting all records', e as Error);
    }
  }

  /**
   * Returns the first candidate locator that resolves to a genuinely visible
   * element, or `undefined` if none do.
   *
   * Ported from CCA's `clickCheckbox` helper, which looped selector candidates
   * and only acted on the first one that passed `element.isVisible()` — not
   * just the first one that matched *something* in the DOM. A single merged
   * locator can resolve to an element that exists but isn't the real
   * interactive target (confirmed live in #26/#43: the ARIA-tree "Toggle
   * selection of all rows" checkbox resolves fine, but clicking or keying it
   * does nothing — a decorative sibling owns the real interaction). Trying
   * candidates in order and gating on visibility is how the original avoided
   * committing to the wrong one.
   */
  private async findVisibleCandidate(candidates: Locator[]): Promise<Locator | undefined> {
    for (const candidate of candidates) {
      const element = candidate.first();
      if ((await element.count()) === 0) continue;
      if (await element.isVisible().catch(() => false)) {
        return element;
      }
    }
    return undefined;
  }

  /**
   * Check whether the header "select all" checkbox reports every record selected.
   */
  async areAllRecordsSelected(): Promise<boolean> {
    try {
      await this.waitForGridLoad();
      const checkbox = await this.findVisibleCandidate(
        this.gridLocators.CheckboxSelectAllCandidates(this.page)
      );
      if (!checkbox) return false;

      // A native <input>'s own `.checked` is authoritative when there is one, but
      // Fluent UI v8's `ms-Checkbox` reflects checked state as an `is-checked`
      // class on the *wrapping* div (confirmed against real DOM in #26) — and the
      // modern grid's role="checkbox" element may not be an <input> at all. Check
      // every signal rather than assuming one representation.
      return await checkbox.evaluate((el: Element) => {
        if (el instanceof HTMLInputElement && el.checked) return true;
        if (el.getAttribute('aria-checked') === 'true') return true;
        const container = el.closest('.ms-Checkbox, .ag-checkbox') ?? el;
        return (
          container.classList.contains('is-checked') || container.classList.contains('ag-checked')
        );
      });
    } catch (e) {
      throw new RethrownError('Error checking whether all records are selected', e as Error);
    }
  }

  /**
   * Select a single record via its row checkbox.
   *
   * Falls back to clicking the row itself when the checkbox isn't visible —
   * the same defensive check `selectRow` already uses (and which is proven to
   * work live), rather than assuming the checkbox is always the right target.
   *
   * @param recordNumber - Row index (0-based)
   */
  async selectNthRecord(recordNumber: number): Promise<void> {
    try {
      const row = this.gridLocators.RowByIndex(this.page, recordNumber);
      await row.waitFor({ state: 'visible', timeout: 30000 });

      const checkbox = this.gridLocators.CheckboxCell(row).first();
      const hasCheckbox = await checkbox.isVisible().catch(() => false);
      if (hasCheckbox) {
        await checkbox.click({ force: true });
      } else {
        await row.click();
      }

      // ag-Grid updates aria-selected/the selected class asynchronously after the
      // click — poll until it does, rather than checking once and discarding the
      // result (which let the method resolve before the selection actually applied).
      await this.page.waitForFunction(
        (element: Element | null) =>
          !!element &&
          (element.getAttribute('aria-selected') === 'true' ||
            element.classList.contains('ag-row-selected')),
        await row.elementHandle(),
        { timeout: 10000 }
      );
    } catch (e) {
      throw new RethrownError(`Error selecting record ${recordNumber}`, e as Error);
    }
  }

  /**
   * Check whether a specific row is currently selected.
   *
   * @param recordNumber - Row index (0-based)
   */
  async isRecordSelected(recordNumber: number): Promise<boolean> {
    try {
      const row = this.gridLocators.RowByIndex(this.page, recordNumber);
      if ((await row.count()) === 0) return false;

      const ariaSelected = await row.getAttribute('aria-selected');
      if (ariaSelected === 'true') return true;

      const classes = await row.getAttribute('class');
      if (classes?.includes('ag-row-selected')) return true;

      const checkbox = row.locator('input[type="checkbox"][aria-label*="select"]');
      if ((await checkbox.count()) > 0) {
        return await checkbox.evaluate((el: HTMLInputElement) => el.checked);
      }

      return false;
    } catch (e) {
      throw new RethrownError(`Error checking whether record ${recordNumber} is selected`, e as Error);
    }
  }

  // ========================================
  // Column Header Menu (sort / filter)
  // Ported from CCA's Grid.ts per ADR 0002
  // ========================================

  /**
   * ag-Grid sometimes renders a column's header text doubled in the DOM
   * (e.g. "Order NumberOrder Number"). This strips that duplication.
   */
  private cleanColumnName(columnText: string): string {
    const trimmed = columnText.trim();
    for (let i = 1; i <= trimmed.length / 2; i++) {
      const firstPart = trimmed.substring(0, i);
      const secondPart = trimmed.substring(i, i * 2);
      if (firstPart === secondPart) return firstPart;
    }
    return trimmed;
  }

  private async findHeaderCellByName(columnName: string): Promise<Locator | undefined> {
    const headerCells = this.gridLocators.HeaderCell(this.page);
    const count = await headerCells.count();

    for (let i = 0; i < count; i++) {
      const cell = headerCells.nth(i);
      const clickableHeader = this.gridLocators.HeaderCellClickable(cell);
      if ((await clickableHeader.count()) === 0) continue;

      const rawText = (await clickableHeader.textContent()) ?? '';
      if (this.cleanColumnName(rawText) === columnName) return cell;
    }

    return undefined;
  }

  /**
   * Open a column's header context menu (sort / filter options).
   *
   * @param columnName - Column display name, as rendered in the header
   */
  async openColumnHeaderMenu(columnName: string): Promise<void> {
    try {
      await this.waitForGridLoad();
      const cell = await this.findHeaderCellByName(columnName);
      if (!cell) throw new Error(`Column header "${columnName}" not found in grid`);

      await this.gridLocators.HeaderCellClickable(cell).click();
      await this.gridLocators.ColumnMenu(this.page).waitFor({ state: 'visible' });
    } catch (e) {
      throw new RethrownError(`Error opening column header menu for "${columnName}"`, e as Error);
    }
  }

  /**
   * Close the column header context menu, if open.
   */
  async closeColumnMenu(): Promise<void> {
    try {
      const menu = this.gridLocators.ColumnMenu(this.page);
      if (await menu.isVisible().catch(() => false)) {
        await this.page.keyboard.press('Escape');
        await menu.waitFor({ state: 'hidden' });
      }
    } catch (e) {
      throw new RethrownError('Error closing column menu', e as Error);
    }
  }

  private async clickColumnMenuOption(optionName: string): Promise<void> {
    const menu = this.gridLocators.ColumnMenu(this.page);
    await menu.waitFor({ state: 'visible' });

    const menuItems = menu.locator(
      'button[role="menuitem"], button[role="menuitemradio"]'
    );
    const count = await menuItems.count();

    for (let i = 0; i < count; i++) {
      const item = menuItems.nth(i);
      const nameAttr = await item.getAttribute('name');
      const text = await item.textContent();

      if (nameAttr === optionName || text?.includes(optionName)) {
        await item.click();
        return;
      }
    }

    throw new Error(`Menu option "${optionName}" not found in column context menu`);
  }

  /**
   * Sort a column ascending (A to Z) via its header context menu.
   *
   * @param columnName - Column display name
   */
  async sortColumnAtoZ(columnName: string): Promise<void> {
    try {
      const cell = await this.findHeaderCellByName(columnName);
      if (!cell) throw new Error(`Column "${columnName}" not found`);
      const colId = (await cell.getAttribute('col-id')) ?? '';

      await this.openColumnHeaderMenu(columnName);
      await this.clickColumnMenuOption('A to Z');
      await this.gridLocators.ColumnMenu(this.page).waitFor({ state: 'hidden' });
      await this.waitForGridLoad();
      // Scoped to this column's col-id — a different column already sorted
      // ascending (e.g. the grid's default sort) must not satisfy this wait.
      await this.page
        .locator(`div.ag-header-cell[col-id="${colId}"][aria-sort="ascending"]`)
        .waitFor({ state: 'attached', timeout: 5000 });
    } catch (e) {
      throw new RethrownError(`Error sorting column "${columnName}" A to Z`, e as Error);
    }
  }

  /**
   * Sort a column descending (Z to A) via its header context menu.
   *
   * @param columnName - Column display name
   */
  async sortColumnZtoA(columnName: string): Promise<void> {
    try {
      const cell = await this.findHeaderCellByName(columnName);
      if (!cell) throw new Error(`Column "${columnName}" not found`);
      const colId = (await cell.getAttribute('col-id')) ?? '';

      await this.openColumnHeaderMenu(columnName);
      await this.clickColumnMenuOption('Z to A');
      await this.gridLocators.ColumnMenu(this.page).waitFor({ state: 'hidden' });
      await this.page
        .locator(`div.ag-header-cell[col-id="${colId}"][aria-sort="descending"]`)
        .waitFor({ state: 'attached' });
    } catch (e) {
      throw new RethrownError(`Error sorting column "${columnName}" Z to A`, e as Error);
    }
  }

  /**
   * Read a column's current `aria-sort` state.
   *
   * @param columnName - Column display name
   * @returns `'asc'`, `'desc'`, or `null` if unsorted
   */
  async getColumnSortState(columnName: string): Promise<'asc' | 'desc' | null> {
    try {
      await this.waitForGridLoad();
      const cell = await this.findHeaderCellByName(columnName);
      if (!cell) return null;

      const ariaSort = await cell.getAttribute('aria-sort');
      return ariaSort === 'ascending' ? 'asc' : ariaSort === 'descending' ? 'desc' : null;
    } catch (e) {
      throw new RethrownError(`Error reading sort state for column "${columnName}"`, e as Error);
    }
  }

  /**
   * Open a column's "Filter by" panel via its header context menu.
   *
   * @param columnName - Column display name
   */
  async openFilterMenu(columnName: string): Promise<void> {
    try {
      await this.openColumnHeaderMenu(columnName);
      await this.clickColumnMenuOption('Filter by');
      await this.gridLocators.FilterPanel(this.page).first().waitFor({ state: 'visible' });
    } catch (e) {
      throw new RethrownError(`Error opening filter menu for column "${columnName}"`, e as Error);
    }
  }

  // ========================================
  // View Selector
  // Ported from CCA's Grid.ts per ADR 0002
  // ========================================

  /**
   * Open the view selector dropdown.
   */
  async openViewSelector(): Promise<void> {
    try {
      await this.waitForGridLoad();
      const button = this.gridLocators.ViewSelectorButton(this.page).first();
      await button.click();
      await this.gridLocators.ViewSelector(this.page).waitFor({ state: 'visible' });
    } catch (e) {
      throw new RethrownError('Error opening view selector', e as Error);
    }
  }

  /**
   * Switch the grid to a different saved view.
   *
   * @param viewName - View display name, as shown in the view selector
   */
  async selectView(viewName: string): Promise<void> {
    try {
      await this.openViewSelector();

      const found = await this.clickViewMenuItem(viewName);
      if (found) {
        await this.waitForGridLoad();
        return;
      }

      await this.searchViews(viewName);
      const foundAfterSearch = await this.clickViewMenuItem(viewName);
      if (!foundAfterSearch) throw new Error(`View "${viewName}" not found in view selector`);

      await this.waitForGridLoad();
    } catch (e) {
      throw new RethrownError(`Error selecting view "${viewName}"`, e as Error);
    }
  }

  private async clickViewMenuItem(viewName: string): Promise<boolean> {
    const items = this.gridLocators.ViewSelector(this.page).locator('button[role="menuitemradio"]');
    const count = await items.count();

    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      const label = item.locator('label.viewName, label.ms-Label');
      if ((await label.count()) === 0) continue;

      const text = (await label.textContent())?.trim();
      if (text === viewName) {
        await item.click();
        return true;
      }
    }

    return false;
  }

  /**
   * Get the currently selected view's display name.
   */
  async getCurrentView(): Promise<string> {
    try {
      await this.openViewSelector();

      const selected = this.gridLocators
        .ViewSelector(this.page)
        .locator('button[role="menuitemradio"][aria-checked="true"]');
      if ((await selected.count()) === 0) throw new Error('No view currently selected');

      const label = selected.locator('label.viewName, label.ms-Label');
      const viewName = (await label.textContent())?.trim() ?? '';

      await this.page.keyboard.press('Escape');
      return viewName;
    } catch (e) {
      throw new RethrownError('Error getting current view', e as Error);
    }
  }

  /**
   * Get every view name listed in the view selector.
   */
  async getAvailableViews(): Promise<string[]> {
    try {
      await this.openViewSelector();

      const items = this.gridLocators.ViewSelector(this.page).locator('button[role="menuitemradio"]');
      const count = await items.count();
      const viewNames: string[] = [];

      for (let i = 0; i < count; i++) {
        const label = items.nth(i).locator('label.viewName, label.ms-Label');
        if ((await label.count()) === 0) continue;
        const text = (await label.textContent())?.trim();
        if (text) viewNames.push(text);
      }

      await this.page.keyboard.press('Escape');
      return viewNames;
    } catch (e) {
      throw new RethrownError('Error getting available views', e as Error);
    }
  }

  /**
   * Search the (already open) view selector by name.
   *
   * @param searchTerm - Text to search for
   */
  async searchViews(searchTerm: string): Promise<void> {
    try {
      const viewSelector = this.gridLocators.ViewSelector(this.page);
      await viewSelector.waitFor({ state: 'visible' });

      const searchBox = viewSelector.locator(
        'input[role="searchbox"], input[placeholder*="Search views"]'
      );
      if ((await searchBox.count()) === 0) throw new Error('View search box not found');

      await searchBox.fill(searchTerm);
      await viewSelector
        .locator('button[role="menuitemradio"]')
        .first()
        .waitFor({ state: 'visible' });
    } catch (e) {
      throw new RethrownError(`Error searching views for "${searchTerm}"`, e as Error);
    }
  }
}
