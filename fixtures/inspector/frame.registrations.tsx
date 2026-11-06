import { defineRegistration } from 'frame-studio/registration';
import { cancelSave, Inspector, initialInspectorProps, type InspectorProps } from './Inspector';
import './inspector.css';

/**
 * The whole integration. Everything Frame may touch is named here, and `render` is one line
 * because the component already takes a frame handle.
 */
export const inspectorRegistration = defineRegistration<InspectorProps>({
  id: 'frame.fixture.inspector',
  version: '1.0.0',
  initialState: 'compact',
  states: {
    compact: { label: 'Compact', shows: ['surface', 'content', 'summary', 'open'], focus: 'open' },
    editing: { label: 'Editing', shows: ['surface', 'content', 'summary', 'form'], focus: 'form' },
    confirmation: { label: 'Confirmation', shows: ['surface', 'content', 'summary', 'receipt'], focus: 'receipt' },
  },
  targets: {
    surface: { label: 'Surface', bounds: 'surface', text: false },
    content: { label: 'Content clip', bounds: 'clip', text: true, clipRadiusPx: 14 },
    summary: { label: 'Summary', bounds: 'translate', text: true },
    open: { label: 'Edit button', bounds: 'translate', text: true },
    form: { label: 'Form', bounds: 'translate', text: true },
    receipt: { label: 'Receipt', bounds: 'translate', text: true },
  },
  commands: {
    open: { label: 'Open' },
    cancel: { label: 'Cancel' },
    submit: { label: 'Submit' },
    back: { label: 'Keep editing' },
    done: { label: 'Done' },
  },
  transitions: [
    { id: 'open', from: 'compact', to: 'editing', command: 'open' },
    { id: 'cancel', from: 'editing', to: 'compact', command: 'cancel' },
    { id: 'submit', from: 'editing', to: 'confirmation', command: 'submit' },
    { id: 'back', from: 'confirmation', to: 'editing', command: 'back' },
    { id: 'done', from: 'confirmation', to: 'compact', command: 'done' },
  ],
  props: {
    merchant: { type: 'string', label: 'Merchant', default: initialInspectorProps.merchant },
    amount: { type: 'string', label: 'Amount', default: initialInspectorProps.amount },
    category: { type: 'enum', label: 'Category', default: initialInspectorProps.category, options: ['Food', 'Travel', 'Software', 'Rent'] },
    note: { type: 'string', label: 'Note', default: initialInspectorProps.note },
    error: { type: 'string', label: 'Error', default: '' },
    saving: { type: 'boolean', label: 'Saving', default: false },
  },
  reset: cancelSave,
  render: (context) => <Inspector {...context} />,
});

export default [inspectorRegistration];
