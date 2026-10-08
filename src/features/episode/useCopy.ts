import * as Clipboard from 'expo-clipboard';
import { useCallback, useState } from 'react';

import { useServices } from '../app/ServicesProvider';

/** クリップボードへコピーし、1.5 秒だけ ✓ を出す（FR-EXP-8）。 */
export function useCopy(holdMs = 1500) {
  const { haptics } = useServices();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(
    async (key: string, text: string) => {
      await Clipboard.setStringAsync(text);
      haptics.play('success');
      setCopied(key);
      setTimeout(() => setCopied((k) => (k === key ? null : k)), holdMs);
    },
    [haptics, holdMs],
  );
  return { copied, copy };
}
