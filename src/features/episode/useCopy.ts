import * as Clipboard from 'expo-clipboard';
import { useCallback, useState } from 'react';

/** クリップボードへコピーし、1.5 秒だけ ✓ を出す（FR-EXP-8）。 */
export function useCopy(holdMs = 1500) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(
    async (key: string, text: string) => {
      await Clipboard.setStringAsync(text);
      setCopied(key);
      setTimeout(() => setCopied((k) => (k === key ? null : k)), holdMs);
    },
    [holdMs],
  );
  return { copied, copy };
}
