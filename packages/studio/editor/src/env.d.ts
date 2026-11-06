/// <reference types="vite/client" />
declare module 'virtual:frame-registrations' {
  import type { AnyRegistration } from '../../authoring/registration';
  const registrations: AnyRegistration[];
  export default registrations;
}
