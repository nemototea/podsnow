import { MIGRATION_0001_INIT } from './0001_init';
import { MIGRATION_0002_EPISODE_NUMBERING } from './0002_episode_numbering';
import { MIGRATION_0003_OUTLINE_AND_EVENTS } from './0003_outline_and_events';
import { MIGRATION_0004_EPISODE_EXPORT_PRESET } from './0004_episode_export_preset';
import { MIGRATION_0005_PODCAST_FEED_METADATA } from './0005_podcast_feed_metadata';
import { MIGRATION_0006_EXPORT_SOURCE_FINGERPRINT } from './0006_export_source_fingerprint';
import { MIGRATION_0007_LOUDNESS_CACHE } from './0007_loudness_cache';
import { MIGRATION_0008_SHOW_COVER_COLOR } from './0008_show_cover_color';
import { MIGRATION_0009_OPTIONAL_EPISODE_NUMBERING } from './0009_optional_episode_numbering';
import { MIGRATION_0010_NOTES } from './0010_notes';

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
  { version: 5, name: '0005_podcast_feed_metadata', sql: MIGRATION_0005_PODCAST_FEED_METADATA },
  {
    version: 6,
    name: '0006_export_source_fingerprint',
    sql: MIGRATION_0006_EXPORT_SOURCE_FINGERPRINT,
  },
  { version: 7, name: '0007_loudness_cache', sql: MIGRATION_0007_LOUDNESS_CACHE },
  { version: 8, name: '0008_show_cover_color', sql: MIGRATION_0008_SHOW_COVER_COLOR },
  {
    version: 9,
    name: '0009_optional_episode_numbering',
    sql: MIGRATION_0009_OPTIONAL_EPISODE_NUMBERING,
  },
  { version: 10, name: '0010_notes', sql: MIGRATION_0010_NOTES },
];
