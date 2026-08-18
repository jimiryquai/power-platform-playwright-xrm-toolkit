/**
 * Xrm client-API layer, per ADR 0001 — replaces MS's monolithic
 * `FormComponent` with this granular, per-concern split.
 */

// Record & field operations (#24)
export { Attribute, SetValueSettings } from './attribute';
export { Entity } from './entity';
export { WebApi } from './web-api';

// Form structure & navigation (#25)
export { Control, ControlState } from './control';
export { SubGrid } from './sub-grid';
export { Tab, TabState } from './tab';
export { Section, SectionState } from './section';
export { Navigation, NavigationSettings, FormNavigationSettings } from './navigation';
export { Form, FormIdentifier, FormSelectorItem } from './form';
