import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useServices } from '@/features/app/ServicesProvider';
import { useT } from '@/i18n';
import { Avatar } from '@/ui/Avatar';
import { Text } from '@/ui/components';
import { useAppTheme } from '@/ui/ThemeContext';
import { typography } from '@/ui/tokens';

/**
 * 下部タブの画面（検索・素材）の上部。Home のロゴの行（見本 `.wmrow`）と同じ置き方で、左に画面の名前、
 * 右に設定への入口のアバター。
 */
export function TabHeader({ title }: { title: string }) {
  const c = useAppTheme();
  const t = useT();
  const router = useRouter();
  const { show } = useServices();
  return (
    <View style={s.row}>
      <Text style={[typography.title, { color: c.textPrimary }]} accessibilityRole="header">
        {title}
      </Text>
      <Avatar
        name={show.author || show.name}
        accessibilityLabel={t.a11y.settings}
        onPress={() => router.push('/settings')}
      />
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
