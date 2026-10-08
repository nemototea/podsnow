import * as ImagePicker from 'expo-image-picker';

import type { ImagePickerPort } from '@/services/shows/ImagePickerPort';

export const expoImagePicker: ImagePickerPort = {
  async pickSquare() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
      selectionLimit: 1,
    });
    if (result.canceled) return null;
    const selected = result.assets[0];
    if (!selected) return null;
    return { uri: selected.uri, width: selected.width, height: selected.height };
  },
};
