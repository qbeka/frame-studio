import { useEffect, useRef } from 'react';

/** The page's real shortcuts. Every one of them is handled in Demo.tsx, Plot.tsx or hand.ts. */
export function Help({ onClose, go, back }: { onClose: () => void; go: string; back: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Safari does not focus a button when it is clicked, so the opener is found by name there.
    const active = document.activeElement;
    const before = active instanceof HTMLElement && active !== document.body ? active : document.getElementById('keys');
    panel.current!.focus({ preventScroll: true });
    return () => before?.focus({ preventScroll: true });
  }, []);
  /** Keys, what they do, and the word between two keys that name a run of them. */
  const rows: [string[], string, string?][] = [
    [['R'], 'Replay the take, or pause it'],
    [['S'], 'Slow motion'],
    [['1', '5'], 'Play an example take', 'to'],
    [['T'], 'Tune the springs and the rule'],
    [['A'], 'Race the take against side B'],
    [['E'], 'Export'],
    [['P'], 'Save the plate as an image'],
    [['↑', '↓'], `On the grab bar, move the edge by hand, then let go`],
    [['Enter'], `On the grab bar, ${go} or ${back}`],
    [['←', '→'], 'On the trace, step through the take or move a press'],
    [['Esc'], 'Close a panel, or this list'],
  ];
  return (
    <div className="help" role="dialog" aria-modal="false" aria-label="Keyboard shortcuts" tabIndex={-1} ref={panel} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
      <header>
        <h2>Keyboard</h2>
        <button type="button" className="control" onClick={onClose} aria-label="Close the list of shortcuts">Close</button>
      </header>
      <dl>
        {rows.map(([keys, what, between]) => (
          <div key={what}>
            <dt>{keys.map((key, i) => (<span key={key}>{i > 0 && between ? <i>{between}</i> : null}<kbd>{key}</kbd></span>))}</dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
