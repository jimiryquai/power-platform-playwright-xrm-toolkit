// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Centralized handling for the modal dialogs D365 raises mid-action.
 *
 * @packageDocumentation
 */

import type { Page } from '@playwright/test';
import { RethrownError } from './rethrown-error';

/**
 * Dialogs that interrupt an in-flight action.
 */
export enum DialogKind {
  /** "Duplicates found" — raised by a save when matching records exist. */
  DuplicateDetection = 'duplicate-detection',
  /** "Your changes have not been saved" — raised when navigating away from a dirty form. */
  UnsavedChanges = 'unsaved-changes',
}

/**
 * What to do when a dialog appears.
 *
 * - `proceed` — dismiss it and let the action continue.
 * - `abort` — dismiss it and fail the action.
 */
export type DialogResponse = 'proceed' | 'abort';

/**
 * Buttons for one dialog.
 *
 * `detect` is the selector raced against the action; it is deliberately one of
 * the two action buttons, so a dialog can never be detected without a known way
 * to dismiss it.
 */
export interface DialogSelectors {
  detect: string;
  proceed: string;
  abort: string;
}

/**
 * UCI renders every modal with the same `data-id="confirmdialog"` container and
 * the same `confirmButton` / `cancelButton` pair — a delete prompt is
 * structurally identical to an unsaved-changes prompt. Matching on the buttons
 * alone would let this class auto-confirm a destructive dialog nobody asked it
 * to touch, so the unsaved-changes dialog is identified by its title.
 *
 * That makes detection locale-dependent. The suite pins `locale: 'en-US'` in
 * playwright.config.ts, so it holds here; a localised run needs this title
 * translated.
 */
const UNSAVED_CHANGES_DIALOG =
  'div[role="dialog"][data-uci-dialog="true"]:has([data-id="dialogTitleText"][title="Unsaved changes"])';

/**
 * Where each dialog's buttons live in the DOM.
 *
 * Buttons are matched by `data-id`, not by `id`: UCI suffixes element ids with a
 * dialog instance number (`confirmButton_1`), so an `#confirmButton` selector
 * matches nothing at all.
 *
 * For unsaved changes the button labels do not map onto proceed/abort the way
 * the names suggest — `confirmButton` is "Save and continue" and `cancelButton`
 * is "Discard changes". Both continue the navigation. `proceed` discards, which
 * is what a test navigating away almost always wants; staying on the page means
 * dismissing via the close icon.
 */
export const DIALOG_SELECTORS: Record<DialogKind, DialogSelectors> = {
  [DialogKind.DuplicateDetection]: {
    detect: 'button[data-id="ignore_save"]',
    proceed: 'button[data-id="ignore_save"]',
    abort: 'button[data-id="close_dialog"]',
  },
  [DialogKind.UnsavedChanges]: {
    detect: `${UNSAVED_CHANGES_DIALOG} button[data-id="cancelButton"]`,
    proceed: `${UNSAVED_CHANGES_DIALOG} button[data-id="cancelButton"]`,
    abort: `${UNSAVED_CHANGES_DIALOG} button[data-id="dialogCloseIconButton"]`,
  },
};

/**
 * Default response per dialog.
 *
 * Duplicates abort, because silently saving a duplicate is a data problem the
 * caller should have to opt into. The unsaved-changes prompt proceeds, because a
 * caller that asked to navigate meant it.
 *
 * Note this deviates from the navigation behaviour it replaces, which clicked
 * "cancel" — staying on the page — and then awaited a navigation that could
 * therefore never complete, hanging until the test timed out.
 */
const DEFAULT_RESPONSES: Record<DialogKind, DialogResponse> = {
  [DialogKind.DuplicateDetection]: 'abort',
  [DialogKind.UnsavedChanges]: 'proceed',
};

/** Per-dialog overrides for a single {@link DialogHandler.run} call. */
export type DialogPolicy = Partial<Record<DialogKind, DialogResponse>>;

/** Tuning for {@link DialogHandler}. */
export interface DialogHandlerSettings {
  /** How long to watch for a dialog while an action is in flight, in ms. */
  timeout?: number;
  /**
   * How long {@link DialogHandler.dismissIfPresent} waits, in ms.
   *
   * Separate from `timeout` because that check asks "is one on screen now"; using
   * the action timeout would stall the common no-dialog path for a full minute.
   */
  presenceTimeout?: number;
  /** Log dialog activity to stdout. */
  debugMode?: boolean;
}

const DEFAULT_SETTINGS: Required<DialogHandlerSettings> = {
  timeout: 60_000,
  presenceTimeout: 1_000,
  debugMode: false,
};

/**
 * Raised when a save is abandoned because D365 found duplicate records.
 */
export class DuplicateRecordsFoundError extends Error {
  constructor() {
    super(
      'Duplicate records found. Pass a policy of ' +
        "{ [DialogKind.DuplicateDetection]: 'proceed' } to save anyway."
    );
    this.name = 'DuplicateRecordsFoundError';
  }
}

/**
 * Dismisses D365 modals that interrupt an action.
 *
 * Saves and navigations can be blocked by a modal the caller did not ask for,
 * and the action's own promise simply hangs while it is on screen. Without this,
 * every method that might trigger one has to hand-roll its own race — which is
 * how the behaviour was previously spread across save and navigation code.
 *
 * @example
 * ```typescript
 * const dialogs = new DialogHandler(page);
 *
 * // Save, accepting duplicates rather than failing on them.
 * const recordId = await dialogs.run(() => savePromise(), {
 *   [DialogKind.DuplicateDetection]: 'proceed',
 * });
 * ```
 */
export class DialogHandler {
  readonly page: Page;
  readonly settings: Required<DialogHandlerSettings>;

  constructor(page: Page, settings?: DialogHandlerSettings) {
    this.page = page;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
  }

  private log(message: string): void {
    if (this.settings.debugMode) {
      console.log(`[DialogHandler] ${message}`);
    }
  }

  /**
   * Run an action, dismissing any known dialog that interrupts it.
   *
   * @param action - Started by this method, so watching begins before it can be
   * interrupted.
   * @param policy - Overrides the default response for specific dialogs.
   * @returns Whatever the action resolves to.
   * @throws {DuplicateRecordsFoundError} When duplicates appear and the policy is `abort`.
   */
  async run<T>(action: () => Promise<T>, policy: DialogPolicy = {}): Promise<T> {
    const actionPromise = action();

    // Resolves on whichever dialog shows up first, and never rejects: a watcher
    // that times out without seeing its dialog is the normal case, not an error.
    // Each watcher settles at its own timeout, so nothing is retained past that.
    //
    // Playwright exposes no way to cancel an in-flight waitForSelector, so when
    // the action wins the watchers keep polling until `timeout` elapses. Keep
    // `timeout` near the action's expected duration rather than arbitrarily high.
    const firstDialog = new Promise<DialogKind>((resolve) => {
      for (const kind of Object.values(DialogKind)) {
        this.page
          .waitForSelector(DIALOG_SELECTORS[kind].detect, {
            timeout: this.settings.timeout,
            state: 'visible',
          })
          .then(
            () => resolve(kind),
            () => undefined
          );
      }
    });

    const winner = await Promise.race([
      actionPromise.then((result) => ({ interrupted: false as const, result })),
      firstDialog.then((kind) => ({ interrupted: true as const, kind })),
    ]);

    if (!winner.interrupted) {
      return winner.result;
    }

    const response = policy[winner.kind] ?? DEFAULT_RESPONSES[winner.kind];
    this.log(`${winner.kind} dialog appeared — responding '${response}'`);

    if (response === 'abort') {
      // The action stays blocked behind the modal and will never resolve; detach
      // it so its eventual rejection is not reported as unhandled.
      void actionPromise.catch(() => undefined);
      await this.clickDialogButton(winner.kind, 'abort');

      if (winner.kind === DialogKind.DuplicateDetection) {
        throw new DuplicateRecordsFoundError();
      }
      throw new Error(`Action aborted by the ${winner.kind} dialog.`);
    }

    await this.clickDialogButton(winner.kind, 'proceed');
    return actionPromise;
  }

  /**
   * Dismiss a dialog if it is already on screen.
   *
   * For the case where a dialog is raised by something other than a single
   * awaitable action. Prefer {@link run} when there is an action to race.
   *
   * @returns Whether a dialog was found and dismissed.
   */
  async dismissIfPresent(kind: DialogKind, response: DialogResponse = 'proceed'): Promise<boolean> {
    const handle = await this.page
      .waitForSelector(DIALOG_SELECTORS[kind].detect, {
        timeout: this.settings.presenceTimeout,
        state: 'visible',
      })
      .catch(() => null);

    if (!handle) {
      return false;
    }

    this.log(`${kind} dialog present — responding '${response}'`);
    await this.clickDialogButton(kind, response);
    return true;
  }

  private async clickDialogButton(kind: DialogKind, response: DialogResponse): Promise<void> {
    const selector = DIALOG_SELECTORS[kind][response];
    try {
      await this.page.click(selector, { timeout: this.settings.timeout });
    } catch (error) {
      throw new RethrownError(
        `Failed to click '${response}' on the ${kind} dialog (${selector})`,
        error as Error
      );
    }
  }
}
