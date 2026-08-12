// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Readiness and idleness waiting for Dynamics 365 / Unified Client Interface.
 *
 * @packageDocumentation
 */

import type { Page } from '@playwright/test';

/**
 * Tuning for {@link XrmHelper}.
 */
export interface XrmHelperSettings {
  /** Maximum time to wait for any single operation, in ms. */
  timeout?: number;
  /** How long the app must stay idle before it counts as settled, in ms. */
  settleTime?: number;
  /** Log progress to stdout. */
  debugMode?: boolean;
}

/**
 * Defaults applied when a setting is not supplied.
 *
 * The settle time exists because UCI reports idle between phases of a single
 * logical operation — a save can look idle briefly while the next request is
 * still queued. Requiring a sustained idle window avoids acting on that gap.
 */
export const XRM_HELPER_DEFAULTS: Required<XrmHelperSettings> = {
  timeout: 60_000,
  settleTime: 2_000,
  debugMode: false,
};

/** How often to re-evaluate the idleness predicate, in ms. */
const IDLENESS_POLL_INTERVAL = 250;

/**
 * Waits for Dynamics 365 to be ready to interact with.
 *
 * Two different conditions matter, and they are not the same thing:
 *
 * - **Xrm ready** — the `Xrm.Page` API exists, so client-API calls will resolve.
 * - **App idle** — UCI has no outstanding work, so the form has stopped changing.
 *
 * A form can satisfy the first and not the second, which is the usual source of
 * flake right after navigation or a save. {@link waitForFormReady} waits for both.
 *
 * @example
 * ```typescript
 * const xrm = new XrmHelper(page);
 * await xrm.waitForFormReady();
 * ```
 */
export class XrmHelper {
  readonly page: Page;
  readonly settings: Required<XrmHelperSettings>;

  constructor(page: Page, settings?: XrmHelperSettings) {
    this.page = page;
    this.settings = { ...XRM_HELPER_DEFAULTS, ...settings };
  }

  private log(message: string): void {
    if (this.settings.debugMode) {
      console.log(`[XrmHelper] ${message}`);
    }
  }

  /**
   * Wait until `window.Xrm.Page` exists in the browser context.
   */
  async waitForXrmReady(): Promise<void> {
    this.log('waitForXrmReady: waiting...');
    await this.page.waitForFunction(
      () => {
        const xrm = (window as unknown as { Xrm?: { Page?: unknown } }).Xrm;
        return typeof xrm !== 'undefined' && !!xrm.Page;
      },
      // Options must be the THIRD argument — passing them second puts them in the
      // page-function `arg` slot and the timeout is silently ignored (CLAUDE.md § 1).
      undefined,
      { timeout: this.settings.timeout }
    );
    this.log('waitForXrmReady: done');
  }

  /**
   * Wait until UCI reports the app idle, continuously, for the settle time.
   *
   * Pages without `UCWorkBlockTracker` (anything outside UCI) count as idle
   * immediately rather than timing out.
   *
   * @param settleTime - Overrides the configured settle time for this call.
   */
  async waitForIdleness(settleTime?: number): Promise<void> {
    const settle = settleTime ?? this.settings.settleTime;
    // Identifies this call's idle streak. Without it, a wait that times out mid-
    // streak leaves its start timestamp on `window`, and the next call measures
    // against a stale time — satisfying the settle window on its very first poll
    // and reporting the app settled without observing a sustained idle period.
    const streakToken = `${Date.now()}-${Math.random()}`;
    this.log(`waitForIdleness: waiting (settle=${settle}ms)...`);

    await this.page.waitForFunction(
      ({ settleMs, token }: { settleMs: number; token: string }) => {
        const tracker = (
          window as unknown as { UCWorkBlockTracker?: { isAppIdle?: () => boolean } }
        ).UCWorkBlockTracker;

        // Not a UCI page — nothing to wait for.
        if (!tracker || typeof tracker.isAppIdle !== 'function') {
          return true;
        }

        // The predicate is re-evaluated on every poll, so the point at which the
        // current idle streak began has to live on `window` between calls.
        const state = window as unknown as {
          __xrmIdleStreak?: { token: string; start: number };
        };

        if (!tracker.isAppIdle()) {
          state.__xrmIdleStreak = undefined;
          return false;
        }

        const now = Date.now();
        // A streak left behind by an earlier call says nothing about this one.
        if (!state.__xrmIdleStreak || state.__xrmIdleStreak.token !== token) {
          state.__xrmIdleStreak = { token, start: now };
        }

        if (now - state.__xrmIdleStreak.start >= settleMs) {
          state.__xrmIdleStreak = undefined;
          return true;
        }

        return false;
      },
      { settleMs: settle, token: streakToken },
      { timeout: this.settings.timeout, polling: IDLENESS_POLL_INTERVAL }
    );

    this.log('waitForIdleness: done');
  }

  /**
   * Wait for Xrm to be available and the app to settle.
   *
   * Use after navigating to a form, or after a save.
   */
  async waitForFormReady(): Promise<void> {
    await this.waitForXrmReady();
    await this.waitForIdleness();
  }
}
