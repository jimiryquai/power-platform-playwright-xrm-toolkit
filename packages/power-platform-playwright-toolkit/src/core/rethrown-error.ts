// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Error wrapping that keeps both sides of a browser boundary.
 *
 * @packageDocumentation
 */

/**
 * Base class that fixes up `name` and trims constructor frames out of the stack.
 */
class ExtendedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;

    if (typeof Error.captureStackTrace === 'function') {
      // Hide the constructor frames so the first frame is the caller.
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = new Error(message).stack;
    }
  }
}

/**
 * Wraps an error with context while preserving the original stack trace.
 *
 * A failure inside `page.evaluate()` arrives with a stack describing the browser
 * only — no frame points at the test that made the call. Re-throwing it bare
 * loses the call site; throwing a fresh error loses the browser detail. This
 * keeps both: the context message and call-site frame first, then the original
 * error's stack beneath it.
 *
 * Per ADR 0001 this applies fork-wide, at every point a browser-evaluated call
 * can fail — the Xrm layer and the DOM/shell layer alike.
 *
 * @example
 * ```typescript
 * try {
 *   await page.evaluate(() => window.Xrm.Page.data.entity.attributes.get(name).getValue());
 * } catch (error) {
 *   throw new RethrownError(`Failed to read attribute '${name}'`, error as Error);
 * }
 * ```
 */
export class RethrownError extends ExtendedError {
  /** The error this one wraps — usually the browser-side failure. */
  readonly originalError: Error;

  /**
   * @param message - Context describing what the caller was attempting.
   * @param error - The original error. Required; without one there is nothing to
   * preserve, so the context message is thrown on its own instead.
   */
  constructor(message: string, error: Error) {
    super(message);

    if (!error) {
      throw new Error(message);
    }

    this.originalError = error;

    // Keep the message (which may span lines) plus the caller's frame, then
    // splice the original stack beneath it.
    const messageLines = (this.message.match(/\n/g) || []).length + 1;
    this.stack =
      (this.stack ?? '')
        .split('\n')
        .slice(0, messageLines + 1)
        .join('\n') +
      '\n' +
      (error.stack ?? '');
  }
}
