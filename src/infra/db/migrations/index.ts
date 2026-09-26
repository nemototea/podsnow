import { MIGRATION_0001_INIT } from './0001_init';
import { MIGRATION_0002_EPISODE_NUMBERING } from './0002_episode_numbering';
import { MIGRATION_0003_OUTLINE_AND_EVENTS } from './0003_outline_and_events';
import { MIGRATION_0004_EPISODE_EXPORT_PRESET } from './0004_episode_export_preset';

export interface Migration {
  /** PRAGMA user_version に対応する。1 から単調増加。 */
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: '0001_init', sql: MIGRATION_0001_INIT },
  { version: 2, name: '0002_episode_numbering', sql: MIGRATION_0002_EPISODE_NUMBERING },
  { version: 3, name: '0003_outline_and_events', sql: MIGRATION_0003_OUTLINE_AND_EVENTS },
  { version: 4, name: '0004_episode_export_preset', sql: MIGRATION_0004_EPISODE_EXPORT_PRESET },
];
