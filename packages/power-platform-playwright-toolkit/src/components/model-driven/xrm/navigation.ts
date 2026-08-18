/**
 * Navigation operations via `window.Xrm.Navigation`.
 *
 * @packageDocumentation
 */

import { XrmHelper } from '../../../core/xrm-helper';
import { RethrownError } from '../../../core/rethrown-error';
import {
  DialogHandler,
  DialogKind,
  DialogPolicy,
  DialogResponse,
} from '../../../core/dialog-handler';

/**
 * Behaviour when navigating away raises D365's "unsaved changes" prompt.
 */
export interface NavigationSettings {
  /**
   * How to respond if navigating away raises the "unsaved changes" dialog.
   * Default (unset): `DialogHandler`'s own default for
   * {@link DialogKind.UnsavedChanges} — `'proceed'`, discarding the changes
   * and completing the navigation. `'abort'` cancels the navigation instead,
   * leaving the dialog dismissed and the form as it was.
   */
  onUnsavedChanges?: DialogResponse;
}

/** {@link NavigationSettings} plus a specific form to open. */
export interface FormNavigationSettings extends NavigationSettings {
  /** The ID of a specific form to open. */
  formId?: string;
}

/**
 * Navigation — D365 navigation operations via `window.Xrm.Navigation`.
 *
 * Provides methods to open create/update/quick-create forms, navigate to
 * arbitrary page inputs, and open a UCI app by ID. Ported from the CCA
 * framework per ADR 0001.
 *
 * CCA's original `handlePopUpOnNavigation` raced navigation against a
 * hand-rolled `D365Selectors`-based popup wait, defaulting to clicking
 * "cancel" — which, per {@link DialogHandler}'s own commit history, meant
 * staying on the page and then awaiting a navigation that could never
 * complete, hanging until the test timed out. This port uses
 * `DialogHandler.run()` with {@link DialogKind.UnsavedChanges} instead,
 * which defaults to discarding and completing the navigation — the fix
 * already made once for `Entity.save`'s equivalent duplicate-detection race.
 *
 * @example
 * ```typescript
 * const modelDrivenApp = new ModelDrivenAppPage(page);
 * await modelDrivenApp.navigation.openCreateForm('nwind_orders');
 * await modelDrivenApp.navigation.openUpdateForm('nwind_orders', recordId);
 * ```
 */
export class Navigation {
  constructor(
    private xrmHelper: XrmHelper,
    private dialogHandler: DialogHandler
  ) {}

  private policyFor(settings?: NavigationSettings): DialogPolicy {
    return settings?.onUnsavedChanges
      ? { [DialogKind.UnsavedChanges]: settings.onUnsavedChanges }
      : {};
  }

  /**
   * Opens a create form for the specified entity.
   */
  async openCreateForm(entityName: string, settings?: FormNavigationSettings): Promise<void> {
    try {
      await this.xrmHelper.waitForXrmReady();

      await this.dialogHandler.run(async () => {
        await this.xrmHelper.page.evaluate(
          ({ entity, formId }) => {
            return (window as any).Xrm.Navigation.openForm({
              entityName: entity,
              formId: formId || undefined,
            });
          },
          { entity: entityName, formId: settings?.formId }
        );
        await this.xrmHelper.waitForIdleness();
      }, this.policyFor(settings));
    } catch (e) {
      throw new RethrownError(`Error opening create form for '${entityName}'`, e as Error);
    }
  }

  /**
   * Opens an update form for an existing record.
   */
  async openUpdateForm(
    entityName: string,
    entityId: string,
    settings?: FormNavigationSettings
  ): Promise<void> {
    try {
      await this.xrmHelper.waitForXrmReady();

      await this.dialogHandler.run(async () => {
        await this.xrmHelper.page.evaluate(
          ({ entity, id, formId }) => {
            return (window as any).Xrm.Navigation.openForm({
              entityName: entity,
              entityId: id,
              formId: formId || undefined,
            });
          },
          { entity: entityName, id: entityId, formId: settings?.formId }
        );
        await this.xrmHelper.waitForIdleness();
      }, this.policyFor(settings));
    } catch (e) {
      throw new RethrownError(
        `Error opening update form for '${entityName}' record '${entityId}'`,
        e as Error
      );
    }
  }

  /**
   * Navigates to the given page input (entity record, entity list, or HTML
   * web resource) — see `Xrm.Navigation.navigateTo`.
   */
  async navigateTo(
    pageInput: Record<string, any>,
    navigationOptions?: Record<string, any>,
    settings?: NavigationSettings
  ): Promise<void> {
    try {
      await this.xrmHelper.waitForXrmReady();

      await this.dialogHandler.run(async () => {
        await this.xrmHelper.page.evaluate(
          ({ input, options }) => {
            return (window as any).Xrm.Navigation.navigateTo(input, options);
          },
          { input: pageInput, options: navigationOptions }
        );
        await this.xrmHelper.waitForIdleness();
      }, this.policyFor(settings));
    } catch (e) {
      throw new RethrownError('Error navigating to page', e as Error);
    }
  }

  /**
   * Opens a quick create form for the specified entity.
   */
  async openQuickCreate(entityName: string): Promise<void> {
    try {
      await this.xrmHelper.waitForXrmReady();

      await this.xrmHelper.page.evaluate((entity: string) => {
        return (window as any).Xrm.Navigation.openForm({
          entityName: entity,
          useQuickCreateForm: true,
        });
      }, entityName);

      await this.xrmHelper.waitForIdleness();
    } catch (e) {
      throw new RethrownError(`Error opening quick create form for '${entityName}'`, e as Error);
    }
  }

  /**
   * Opens a UCI app by its ID, navigating the page directly to its URL.
   * @param appUrl The base MDA URL, used to construct the navigation URL.
   */
  async openAppById(appId: string, appUrl: string, settings?: NavigationSettings): Promise<void> {
    try {
      const separator = appUrl.includes('?') ? '&' : '?';
      const navigationUrl = `${appUrl}${separator}appid=${appId}`;

      await this.dialogHandler.run(async () => {
        await this.xrmHelper.page.goto(navigationUrl, {
          waitUntil: 'load',
          timeout: this.xrmHelper.settings.timeout,
        });
        await this.xrmHelper.waitForIdleness();
      }, this.policyFor(settings));
    } catch (e) {
      throw new RethrownError(`Error opening app '${appId}'`, e as Error);
    }
  }
}
