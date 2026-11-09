import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { MotionSpec } from '../../runtime/spec';
import { parseProject, serializeProject, type Project, type Take } from '../../authoring/project';

/**
 * Project state with undo. History holds whole immutable projects, which is the simplest thing
 * that is correct: an edit is a function from project to project, so nothing has to be inverted.
 * Dragging a number produces many edits, so edits with the same `group` merge into one undo step.
 */
interface History {
  past: Project[];
  present: Project;
  future: Project[];
  group: string | null;
  saved: string;
  /** The project with the registration's example take loaded. It was never the visitor's work. */
  seeded: string | null;
  /** Moves when the project changes from outside the session: undo, redo, open. */
  revision: number;
}

type Action =
  | { type: 'edit'; update: (p: Project) => Project; group: string | null }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'replace'; project: Project; saved?: string }
  | { type: 'seed'; take: Take }
  | { type: 'saved'; saved: string };

const HISTORY_LIMIT = 200;

function reducer(history: History, action: Action): History {
  switch (action.type) {
    case 'edit': {
      const present = action.update(history.present);
      if (present === history.present) return history;
      const merge = action.group !== null && action.group === history.group;
      return {
        ...history,
        past: merge ? history.past : [...history.past, history.present].slice(-HISTORY_LIMIT),
        present,
        future: [],
        group: action.group,
      };
    }
    case 'undo': {
      const previous = history.past[history.past.length - 1];
      if (!previous) return history;
      return { ...history, past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future], group: null, revision: history.revision + 1 };
    }
    case 'redo': {
      const [next, ...future] = history.future;
      if (!next) return history;
      return { ...history, past: [...history.past, history.present], present: next, future, group: null, revision: history.revision + 1 };
    }
    case 'replace':
      return {
        past: [...history.past, history.present].slice(-HISTORY_LIMIT),
        present: action.project,
        future: [],
        group: null,
        saved: action.saved ?? history.saved,
        seeded: null,
        revision: history.revision + 1,
      };
    case 'seed': {
      // Not an edit: there is nothing to undo, and nothing here that needs saving.
      const present = { ...history.present, take: action.take };
      return { ...history, present, group: null, seeded: serializeProject(present) };
    }
    case 'saved':
      return { ...history, saved: action.saved };
  }
}

export const DRAFT_PREFIX = 'frame.draft.';

export interface DraftInfo {
  project: Project;
  savedAt: string;
}

/** Reads a draft. A damaged draft is treated as absent: it must never block opening the app. */
export function readDraft(componentId: string): DraftInfo | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + componentId);
    if (!raw) return null;
    const { savedAt, project } = JSON.parse(raw);
    const parsed = parseProject(project);
    return parsed.ok ? { project: parsed.value, savedAt } : null;
  } catch {
    return null;
  }
}

function writeDraft(componentId: string, project: Project): boolean {
  try {
    localStorage.setItem(
      DRAFT_PREFIX + componentId,
      JSON.stringify({ savedAt: new Date().toISOString(), project }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(componentId: string) {
  try {
    localStorage.removeItem(DRAFT_PREFIX + componentId);
  } catch {
    // Storage can be blocked. There is nothing to clear in that case.
  }
}

export function useProjectStore(initial: Project, saved: string) {
  const [history, dispatch] = useReducer(reducer, null, () => ({
    past: [],
    present: initial,
    future: [],
    group: null,
    saved,
    seeded: null,
    revision: 0,
  }));
  const project = history.present;
  const componentId = project.spec.component.id;
  const serialized = useMemo(() => serializeProject(project), [project]);
  const dirty = serialized !== history.saved && serialized !== history.seeded;

  useEffect(() => {
    if (!dirty) {
      clearDraft(componentId);
      return undefined;
    }
    const timer = setTimeout(() => writeDraft(componentId, project), 250);
    return () => clearTimeout(timer);
  }, [project, dirty, componentId]);

  const editSpec = useCallback(
    (update: (spec: MotionSpec) => MotionSpec, group: string | null = null) =>
      dispatch({ type: 'edit', group, update: (p) => ({ ...p, spec: update(p.spec) }) }),
    [],
  );
  const setTake = useCallback(
    (take: Take | null, group: string | null = null) =>
      dispatch({ type: 'edit', group, update: (p) => (p.take === take ? p : { ...p, take }) }),
    [],
  );
  const rename = useCallback(
    (name: string) => dispatch({ type: 'edit', group: 'name', update: (p) => ({ ...p, name }) }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const replace = useCallback((next: Project, savedText?: string) => dispatch({ type: 'replace', project: next, saved: savedText }), []);
  const markSaved = useCallback((text: string) => dispatch({ type: 'saved', saved: text }), []);
  const seedTake = useCallback((take: Take) => dispatch({ type: 'seed', take }), []);

  return {
    project,
    serialized,
    dirty,
    revision: history.revision,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    editSpec,
    setTake,
    rename,
    undo,
    redo,
    replace,
    markSaved,
    seedTake,
  };
}

export type ProjectStore = ReturnType<typeof useProjectStore>;
