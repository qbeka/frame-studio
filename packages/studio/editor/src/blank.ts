import { PROJECT_FORMAT, PROJECT_VERSION, type Project } from '../../authoring/project';
import type { AnyRegistration } from '../../authoring/registration';
import { createStarterSpec } from '../../authoring/starter';

export function blankProjectFor(registration: AnyRegistration): Project {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: registration.id,
    spec: registration.defaultSpec ?? createStarterSpec(registration),
    take: null,
  };
}
