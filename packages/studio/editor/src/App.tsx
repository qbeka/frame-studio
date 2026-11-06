import { useMemo, useRef, useState } from 'react';
import { serializeProject } from '../../authoring/project';
import { checkAgainstRegistration } from '../../authoring/starter';
import type { AnyRegistration } from '../../authoring/registration';
import { blankProjectFor } from './blank';
import { Studio } from './Studio';
import { readDraft } from './store';

export function App({ registrations }: { registrations: AnyRegistration[] }) {
  const [index, setIndex] = useState(0);
  const registration = registrations[index];
  const cache = useRef(new Map<string, ReturnType<typeof open>>());
  const opened = useMemo(() => {
    if (!registration) return null;
    let found = cache.current.get(registration.id);
    if (!found) {
      found = open(registration);
      cache.current.set(registration.id, found);
    }
    return found;
  }, [registration]);

  if (!registration || !opened) {
    return (
      <main className="empty-app">
        <h1>No component is registered</h1>
        <p>
          Pass a registrations file to <code>frame dev</code>. Its default export should be a list of registrations.
        </p>
      </main>
    );
  }

  return (
    <Studio
      key={registration.id}
      registration={registration}
      registrations={registrations}
      onPickRegistration={setIndex}
      initial={opened.project}
      saved={opened.saved}
      recoveredAt={opened.recoveredAt}
    />
  );
}

function open(registration: AnyRegistration) {
  const blank = blankProjectFor(registration);
  const saved = serializeProject(blank);
  const draft = readDraft(registration.id);
  // A draft written against an older shape of the component is not applied.
  if (draft && checkAgainstRegistration(draft.project.spec, registration).length === 0) {
    return { project: draft.project, saved, recoveredAt: draft.savedAt };
  }
  return { project: blank, saved, recoveredAt: null };
}
