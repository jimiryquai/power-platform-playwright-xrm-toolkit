import { describe, it, expect } from 'vitest';
import type { Page } from '@playwright/test';
import { RethrownError } from '../../core/rethrown-error';
import { GridComponent } from './grid.component';

/**
 * Fake ColumnHeader locator that records every `.click()` and reports a
 * configured `aria-sort` attribute — just enough to exercise the sort-toggle
 * logic without a real ag-Grid DOM.
 */
function makeHeaderLocator(ariaSort: string | null, clicks: string[]) {
  return {
    waitFor: async () => undefined,
    getAttribute: async (attr: string) => (attr === 'aria-sort' ? ariaSort : null),
    click: async () => {
      clicks.push('header-click');
    },
  };
}

function makeGridComponent(ariaSort: string | null) {
  const clicks: string[] = [];
  const gridLocators = {
    ColumnHeader: () => makeHeaderLocator(ariaSort, clicks),
    Container: () => ({ waitFor: async () => undefined }),
    LoadingIndicator: () => ({ waitFor: async () => Promise.reject(new Error('not found')) }),
  };
  const page = {} as unknown as Page;
  const grid = new GridComponent(page, gridLocators);
  return { grid, clicks };
}

describe('GridComponent.sortByColumn', () => {
  it('clicks once to flip from descending to ascending, not twice', async () => {
    // Regression test for the known defect noted in #26: the header was read
    // once and then two separate `if`s fired against that stale snapshot,
    // so a single flip (desc -> asc) got immediately clicked back to desc.
    const { grid, clicks } = makeGridComponent('descending');

    await grid.sortByColumn('Order Number', 'asc');

    expect(clicks).toEqual(['header-click']);
  });

  it('clicks once to flip from ascending to descending, not twice', async () => {
    const { grid, clicks } = makeGridComponent('ascending');

    await grid.sortByColumn('Order Number', 'desc');

    expect(clicks).toEqual(['header-click']);
  });

  it('does not click when already sorted in the requested direction', async () => {
    const { grid, clicks } = makeGridComponent('ascending');

    await grid.sortByColumn('Order Number', 'asc');

    expect(clicks).toEqual([]);
  });

  it('wraps a failure in a RethrownError naming the column and direction', async () => {
    const gridLocators = {
      ColumnHeader: () => ({
        waitFor: async () => {
          throw new Error('boom');
        },
      }),
    };
    const grid = new GridComponent({} as unknown as Page, gridLocators);

    const call = grid.sortByColumn('Order Number', 'asc');

    await expect(call).rejects.toBeInstanceOf(RethrownError);
    await expect(call).rejects.toThrow(/Order Number/);
    await expect(call).rejects.toThrow(/asc/);
  });
});

describe('GridComponent.sortColumnAtoZ', () => {
  /**
   * Fakes just enough of the header-menu round trip (find the "Order Number"
   * header, open its menu, click "A to Z") to reach the final wait, then
   * records every selector `page.locator()` was asked to wait on.
   */
  function makeColumnMenuGridComponent() {
    const colId = 'nwind_ordernumber';
    const clickableHeader = {
      count: async () => 1,
      textContent: async () => 'Order Number',
      click: async () => undefined,
    };
    const headerCell = { getAttribute: async (attr: string) => (attr === 'col-id' ? colId : null) };
    const headerCells = { count: async () => 1, nth: () => headerCell };
    const menuItem = {
      getAttribute: async (attr: string) => (attr === 'name' ? 'A to Z' : null),
      textContent: async () => 'A to Z',
      click: async () => undefined,
    };
    const menuItems = { count: async () => 1, nth: () => menuItem };
    const columnMenu = {
      waitFor: async () => undefined,
      isVisible: async () => true,
      locator: () => menuItems,
    };
    const gridLocators = {
      HeaderCell: () => headerCells,
      HeaderCellClickable: () => clickableHeader,
      ColumnMenu: () => columnMenu,
      Container: () => ({ waitFor: async () => undefined }),
      LoadingIndicator: () => ({ waitFor: async () => Promise.reject(new Error('not found')) }),
    };

    const waitedSelectors: string[] = [];
    const page = {
      locator: (selector: string) => {
        waitedSelectors.push(selector);
        return { waitFor: async () => undefined };
      },
    } as unknown as Page;

    return { grid: new GridComponent(page, gridLocators), waitedSelectors, colId };
  }

  it('waits for the sorted column specifically, by col-id, not any ascending column', async () => {
    // Regression test: a different column already sorted ascending (e.g. the
    // grid's default sort) must not satisfy this wait — only sortColumnZtoA
    // originally scoped its wait by col-id; sortColumnAtoZ did not.
    const { grid, waitedSelectors, colId } = makeColumnMenuGridComponent();

    await grid.sortColumnAtoZ('Order Number');

    const finalWait = waitedSelectors[waitedSelectors.length - 1];
    expect(finalWait).toContain(`col-id="${colId}"`);
    expect(finalWait).toContain('aria-sort="ascending"');
  });
});

describe('GridComponent.getRowCount', () => {
  it('wraps a locator failure in a RethrownError', async () => {
    const page = {
      locator: () => ({
        count: async () => {
          throw new Error('boom');
        },
      }),
    } as unknown as Page;
    const grid = new GridComponent(page, {});

    await expect(grid.getRowCount()).rejects.toBeInstanceOf(RethrownError);
  });
});
