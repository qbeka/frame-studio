import type { MotionSpec } from '../../runtime/spec';
import type { Take } from '../../authoring/project';
import type { ProjectStore } from './store';
import { usePlayhead, type Session } from './session';

export function Transport({ session, take }: { spec: MotionSpec; take: Take | null; session: Session; store: ProjectStore }) {
  const t = usePlayhead(session);
  return (
    <section className="transport" aria-label="Transport">
      <button type="button" className="button" onClick={session.reset}>Reset</button>
      <span className="mono">{Math.round(t)} ms</span>
      <span className="hint">{take ? `${take.events.length} events recorded` : 'Press Edit expense, then Cancel before it settles.'}</span>
    </section>
  );
}
