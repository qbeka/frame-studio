import { defineRegistration } from 'frame-studio/registration';
import { Receipt, initialReceiptProps, type ReceiptProps } from './Receipt';
import './receipt.css';

export default [
  defineRegistration<ReceiptProps>({
    id: 'acme.receipt',
    version: '1.0.0',
    initialState: 'folded',
    states: {
      folded: { label: 'Folded', shows: ['paper', 'sheet', 'head'], focus: 'head' },
      itemized: { label: 'Itemized', shows: ['paper', 'sheet', 'head', 'lines'], focus: 'lines' },
      disputed: { label: 'Disputed', shows: ['paper', 'sheet', 'head', 'dispute', 'stamp'], focus: 'dispute' },
    },
    targets: {
      paper: { label: 'Paper', bounds: 'surface', text: false },
      sheet: { label: 'Sheet', bounds: 'clip', text: true, clipRadiusPx: 4 },
      head: { label: 'Heading', bounds: 'translate', text: true },
      lines: { label: 'Line items', bounds: 'translate', text: true },
      dispute: { label: 'Dispute form', bounds: 'translate', text: true },
      stamp: { label: 'Stamp', bounds: 'scale', text: false },
    },
    commands: {
      unfold: { label: 'Unfold' },
      fold: { label: 'Fold' },
      dispute: { label: 'Dispute' },
      withdraw: { label: 'Withdraw' },
    },
    transitions: [
      { id: 'unfold', from: 'folded', to: 'itemized', command: 'unfold' },
      { id: 'fold', from: 'itemized', to: 'folded', command: 'fold' },
      { id: 'dispute', from: 'itemized', to: 'disputed', command: 'dispute' },
      { id: 'withdraw', from: 'disputed', to: 'itemized', command: 'withdraw' },
      { id: 'fold-dispute', from: 'disputed', to: 'folded', command: 'fold' },
    ],
    props: {
      vendor: { type: 'string', label: 'Vendor', default: initialReceiptProps.vendor },
      total: { type: 'string', label: 'Total', default: initialReceiptProps.total },
      reason: { type: 'string', label: 'Reason', default: '' },
    },
    reset() {},
    render: (context) => <Receipt {...context} />,
  }),
];
