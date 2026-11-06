import { useMemo, useRef, useState } from 'react';
import { createStarterSpec } from '../../authoring/starter';
import { PROJECT_FORMAT, PROJECT_VERSION, serializeProject, type Project } from '../../authoring/project';
import { checkAgainstRegistration } from '../../authoring/starter';
import type { AnyRegistration } from '../../authoring/registration';
import { Studio } from './Studio';
import { readDraft } from './store';

export function blankProject(registration: AnyRegistration): Project {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: registration.id,
    spec: createStarterSpec(registration),
    take: null,
  };
}

export function App({ registrations }: { registrations: AnyRegistration[] }) {
  const [index, setIndex] = useState(0);
  const registration = registrations[index];
  const opening = useRef(new Map<string, ReturnType<typeof open>>());
  const opened = useMemo(() => {
    if (!registration) return null;
    let found = opening.current.get(registration.id);
    if (!found) {
      found = open(registration);
      opening.current.set(registration.id, found);
    }
    return found;
  }, [registration]);

  if (!registration || !opened) {
    return (
      <main className="empty-app">
        <h1>No component is registered</h1>
        <p>Pass a registrations file to <code>frame dev</code>. It should export a list of registrations as its default export.</p>
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
  const blank = blankProject(registration);
  const saved = serializeProject(blank);
  const draft = readDraft(registration.id);
  // A draft from an older shape of the component is not silently applied.
  if (draft && checkAgainstRegistration(draft.project.spec, registration).length === 0) {
    return { project: draft.project, saved, recoveredAt: draft.savedAt };
  }
  return { project: blank, saved, recoveredAt: null };
}
