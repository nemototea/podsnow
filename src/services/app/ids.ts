import * as Crypto from 'expo-crypto';

/** UUID v4（DATA_MODEL.md §1）。 */
export function newId(): string {
  return Crypto.randomUUID();
}
