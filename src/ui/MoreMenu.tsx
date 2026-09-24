import { useState } from 'react';

import { IconButton, Row } from './components';
import type { MoreMenuProps } from './menuTypes';
import { Sheet } from './Sheet';

export type { MoreMenuProps };

/** 「…」ボタンとその操作（Android と Web はシート。iOS は `MoreMenu.ios.tsx`）。 */
export function MoreMenu({ label, title, actions, disabled }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton name="more" label={label} onPress={() => setOpen(true)} disabled={!!disabled} />
      <Sheet visible={open} onClose={() => setOpen(false)} {...(title ? { title } : {})}>
        {actions.map((a, i) => (
          <Row
            key={a.key}
            label={a.label}
            {...(a.sub ? { sub: a.sub } : {})}
            {...(a.icon ? { icon: a.icon } : {})}
            danger={!!a.destructive}
            last={i === actions.length - 1}
            onPress={() => {
              setOpen(false);
              a.onPress();
            }}
          />
        ))}
      </Sheet>
    </>
  );
}
