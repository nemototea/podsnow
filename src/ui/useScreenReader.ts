import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * スクリーンリーダー（VoiceOver / TalkBack）が動いているか。
 * 指の操作（ピンチなど）だけに頼る機能に、読み上げ中だけ代わりのボタンを出すために使う。
 */
export function useScreenReader(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((v) => {
      if (alive) setOn(v);
    });
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setOn);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return on;
}
