import { MIGRATION_0001_INIT } from './0001_init';

export interface Migration {
  /** PRAGMA user_version に対応する。1 から単調増加。 */
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: '0001_init', sql: MIGRATION_0001_INIT },
];
