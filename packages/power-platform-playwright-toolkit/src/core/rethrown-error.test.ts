import { describe, it, expect } from 'vitest';
import { RethrownError } from './rethrown-error';

/**
 * A page.evaluate() failure, as Playwright surfaces it: the message and stack
 * describe what happened *inside the browser*, and carry no frame from the test
 * file that made the call. Reproducing the shape here keeps these tests fast and
 * tenant-free while still exercising the case that matters.
 */
function browserSideError(): Error {
  const error = new Error('Attribute not found: nwind_ordernumber');
  error.stack = [
    'Error: Attribute not found: nwind_ordernumber',
    '    at eval (eval at evaluate (:234:30), <anonymous>:2:11)',
    '    at UtilityScript.evaluate (<anonymous>:236:17)',
    '    at UtilityScript.<anonymous> (<anonymous>:1:44)',
  ].join('\n');
  return error;
}

describe('RethrownError', () => {
  it('preserves the browser-side stack trace', () => {
    const original = browserSideError();

    const rethrown = new RethrownError('Failed to read attribute', original);

    expect(rethrown.stack).toContain('at eval (eval at evaluate');
    expect(rethrown.stack).toContain('UtilityScript.evaluate');
  });

  it('preserves the test-call-site stack trace', () => {
    const original = browserSideError();

    // Wrapping inside a named function gives us a frame to assert on — this is
    // the half a bare `throw error` loses.
    function callSiteThatWraps(): RethrownError {
      return new RethrownError('Failed to read attribute', original);
    }
    const rethrown = callSiteThatWraps();

    expect(rethrown.stack).toContain('callSiteThatWraps');
    expect(rethrown.stack).toContain('rethrown-error.test.ts');
  });

  it('carries both stacks at once, browser frames after the call site', () => {
    const original = browserSideError();

    function callSiteThatWraps(): RethrownError {
      return new RethrownError('Failed to read attribute', original);
    }
    const rethrown = callSiteThatWraps();

    const callSiteIndex = rethrown.stack!.indexOf('callSiteThatWraps');
    const browserIndex = rethrown.stack!.indexOf('UtilityScript.evaluate');

    expect(callSiteIndex).toBeGreaterThan(-1);
    expect(browserIndex).toBeGreaterThan(-1);
    expect(callSiteIndex).toBeLessThan(browserIndex);
  });

  it('keeps the context message and exposes the original error', () => {
    const original = browserSideError();

    const rethrown = new RethrownError("Failed to read attribute 'x'", original);

    expect(rethrown.message).toBe("Failed to read attribute 'x'");
    expect(rethrown.originalError).toBe(original);
    expect(rethrown.stack).toContain("Failed to read attribute 'x'");
  });

  it('reports itself as a RethrownError rather than a bare Error', () => {
    const rethrown = new RethrownError('context', browserSideError());

    expect(rethrown.name).toBe('RethrownError');
    expect(rethrown).toBeInstanceOf(RethrownError);
    expect(rethrown).toBeInstanceOf(Error);
  });

  it('retains every line of a multi-line context message', () => {
    const original = browserSideError();
    const message = 'Failed to save record\nEntity: account\nOperation: create';

    const rethrown = new RethrownError(message, original);

    expect(rethrown.stack).toContain('Entity: account');
    expect(rethrown.stack).toContain('Operation: create');
    // ...and still reaches the browser frames below the message.
    expect(rethrown.stack).toContain('UtilityScript.evaluate');
  });

  it('throws the context message when no original error is supplied', () => {
    expect(() => new RethrownError('context only', undefined as unknown as Error)).toThrow(
      'context only'
    );
  });
});
