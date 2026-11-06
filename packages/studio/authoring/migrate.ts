/**
 * Format migrations. Version 1 is the first format, so the shipped table is empty.
 *
 * The first incompatible change works like this. Add the new version to the runtime types, and
 * add an entry here keyed by the old version that returns the next version's plain object.
 * Files are upgraded one step at a time, then parsed. Never edit a released entry. Upgrading
 * happens before validation, so a migration only has to handle documents that were valid.
 * A file from a newer version than this build understands is refused rather than guessed at.
 */
export type Migration = (document: Record<string, unknown>) => Record<string, unknown>;
export type MigrationTable = Record<number, Migration>;

export const MIGRATIONS: MigrationTable = {};

export type MigrationResult =
  | { ok: true; document: Record<string, unknown>; from: number }
  | { ok: false; message: string };

export function migrate(
  document: Record<string, unknown>,
  current: number,
  table: MigrationTable = MIGRATIONS,
): MigrationResult {
  const from = document.version;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) {
    return { ok: false, message: `version must be a whole number from 1, got ${JSON.stringify(from)}` };
  }
  if (from > current) {
    return { ok: false, message: `This file uses format ${from}. This build reads up to format ${current}.` };
  }
  let next = document;
  for (let version = from; version < current; version += 1) {
    const step = table[version];
    if (!step) return { ok: false, message: `No migration from format ${version}.` };
    next = step(next);
    if (next.version !== version + 1) {
      return { ok: false, message: `The migration from format ${version} did not produce format ${version + 1}.` };
    }
  }
  return { ok: true, document: next, from };
}
