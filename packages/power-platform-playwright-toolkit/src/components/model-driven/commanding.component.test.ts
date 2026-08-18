import { describe, it, expect } from 'vitest';
import type { Page } from '@playwright/test';
import { CommandingComponent, CommandBarContext } from './commanding.component';

/**
 * Minimal fake Locator/Page pair that records the full chained selector path
 * for every `.click()`, and reports configured `count`/`visible`/`enabled`/
 * attribute values keyed by that same path.
 *
 * `.first()` does not change the path — it is a filter, not a new selector —
 * so a configured entry matches regardless of whether `.first()` was called.
 */
function makeFakePage(selectors: Record<string, { count?: number; visible?: boolean; enabled?: boolean; attr?: Record<string, string | null> }> = {}) {
  const clicked: string[] = [];

  function makeLocator(pathParts: string[]): any {
    const key = pathParts.join(' >> ');
    const config = selectors[key];
    return {
      locator: (selector: string) => makeLocator([...pathParts, selector]),
      first: () => makeLocator(pathParts),
      count: async () => config?.count ?? 0,
      isVisible: async () => config?.visible ?? false,
      isEnabled: async () => config?.enabled ?? false,
      getAttribute: async (attr: string) => config?.attr?.[attr] ?? null,
      click: async () => {
        clicked.push(key);
      },
      waitFor: async () => undefined,
    };
  }

  const page = {
    locator: (selector: string) => makeLocator([selector]),
    waitForTimeout: async () => undefined,
  } as unknown as Page;

  return { page, clicked };
}

describe('CommandingComponent.openOverflowMenu', () => {
  it('opens the overflow menu via its own trigger button, not a button-name locator built from the context value', async () => {
    // Regression test for the bug fixed in #26: CommandBarContext is a string
    // enum, so `typeof contextOrButtonName === 'string'` was always true and
    // the "context provided" branch (the real OverflowButton trigger) was
    // unreachable — every call built a `[role="menu"]`-scoped button-name
    // locator out of the context string ('form') instead.
    const { page, clicked } = makeFakePage({
      'button[data-id*="OverflowButton"]': { attr: { 'aria-expanded': 'false' } },
    });
    const commanding = new CommandingComponent(page);

    await commanding.openOverflowMenu(CommandBarContext.Form);

    expect(clicked).toEqual(['button[data-id*="OverflowButton"]']);
  });

  it('does not click the trigger again when the overflow menu is already expanded', async () => {
    const { page, clicked } = makeFakePage({
      'button[data-id*="OverflowButton"]': { attr: { 'aria-expanded': 'true' } },
    });
    const commanding = new CommandingComponent(page);

    await commanding.openOverflowMenu(CommandBarContext.Form);

    expect(clicked).toEqual([]);
  });
});

describe('CommandingComponent.clickButton', () => {
  it('falls back to the overflow menu and clicks the button there when it is not in the main command bar', async () => {
    const overflowItemKey =
      '[role="menu"] >> button[aria-label="Export to Excel"], button[title="Export to Excel"], button:has-text("Export to Excel")';
    const { page, clicked } = makeFakePage({
      'button[data-id*="OverflowButton"]': { attr: { 'aria-expanded': 'false' } },
      [overflowItemKey]: { count: 1 },
    });
    const commanding = new CommandingComponent(page);

    await commanding.clickButton('Export to Excel', { waitForEnabled: false });

    expect(clicked).toContain('button[data-id*="OverflowButton"]');
    expect(clicked).toContain(overflowItemKey);
  });

  it('throws when the button is in neither the main bar nor the overflow menu', async () => {
    const { page } = makeFakePage({
      'button[data-id*="OverflowButton"]': { attr: { 'aria-expanded': 'false' } },
    });
    const commanding = new CommandingComponent(page);

    await expect(commanding.clickButton('Nonexistent')).rejects.toThrow(
      /Nonexistent.*not found in command bar/
    );
  });
});

describe('CommandingComponent.isButtonVisible', () => {
  it('checks the overflow menu using the button-name locator, not the trigger locator', async () => {
    const overflowItemKey =
      '[role="menu"] >> button[aria-label="Export to Excel"], button[title="Export to Excel"], button:has-text("Export to Excel")';
    const { page } = makeFakePage({
      'button[data-id*="OverflowButton"]': { attr: { 'aria-expanded': 'false' } },
      [overflowItemKey]: { visible: true },
    });
    const commanding = new CommandingComponent(page);

    const visible = await commanding.isButtonVisible('Export to Excel');

    expect(visible).toBe(true);
  });
});
