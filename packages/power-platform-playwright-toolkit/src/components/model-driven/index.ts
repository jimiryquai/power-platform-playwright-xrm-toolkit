// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Model-Driven App Components
 * Reusable component abstractions for common Model-Driven App UI patterns
 */

export * from './types';
export * from './grid.component';
export * from './commanding.component';
export * from './sidebar.component';
export * from './xrm';

// Standalone Xrm functions (getFormContext, getEntityAttribute, executeInFormContext, etc.).
// `FormComponent`, the OOP wrapper around these, is retired per ADR 0001 — replaced by the
// granular classes above. The standalone functions themselves stay: form-context.test.ts
// depends directly on `getAllEntityAttributes` and `executeInFormContext`, neither of which
// has an equivalent yet on the granular classes (tracked in #42 for the readiness-poll gap;
// getAllEntityAttributes has no tracking issue yet).
export * from './form.context';
