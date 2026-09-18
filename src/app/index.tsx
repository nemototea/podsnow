import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/ui/theme';

// Home（仮）。Issue #21 で実装する。
export default function HomeScreen() {
  const c = palette.dark;
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={styles.body}>
        <Text style={[styles.eyebrow, { color: c.ink2 }]}>PODSNOW</Text>
        <Text style={[styles.title, { color: c.ink }]}>収録の準備中</Text>
        <Text style={[styles.sub, { color: c.ink2 }]}>Phase 0: 骨組みとスパイク</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, padding: 24, justifyContent: 'center' },
  eyebrow: { fontSize: 11, letterSpacing: 2 },
  title: { fontSize: 26, fontWeight: '700', marginTop: 8 },
  sub: { fontSize: 14, marginTop: 6 },
});
