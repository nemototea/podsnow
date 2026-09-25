import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { IconButton } from './components';
import type { HeaderMenuProps } from './menuTypes';
import { MoreMenu } from './MoreMenu';

/**
 * ナビゲーションバー右のボタンと「…」（Android と Web）。iOS は `HeaderMenu.ios.tsx`。
 * `headerRight` は 1 つしか効かないので、ボタンと「…」を 1 つの行にまとめて渡す。
 */
export function HeaderMenu({ buttons, ...menu }: HeaderMenuProps) {
  return (
    <Stack.Screen
      options={{
        headerRight: () => (
          <View style={st.row}>
            {buttons?.map((b) => (
              <IconButton
                key={b.key}
                name={b.icon}
                label={b.label}
                disabled={!!b.disabled}
                onPress={b.onPress}
              />
            ))}
            <MoreMenu {...menu} />
          </View>
        ),
      }}
    />
  );
}

const st = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center' } });
