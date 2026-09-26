import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { ImageProcessorPort } from '@/services/shows/ImageProcessorPort';

/** SDK 57 のコンテキスト API で正方形 JPEG へ正規化する。 */
export const expoImageProcessor: ImageProcessorPort = {
  async normalizeSquareJpeg(source, maxPixels) {
    const side = Math.min(source.width, source.height);
    const context = ImageManipulator.manipulate(source.uri);
    if (source.width !== source.height) {
      context.crop({
        originX: Math.max(0, Math.floor((source.width - side) / 2)),
        originY: Math.max(0, Math.floor((source.height - side) / 2)),
        width: side,
        height: side,
      });
    }
    if (side > maxPixels) context.resize({ width: maxPixels, height: maxPixels });
    const rendered = await context.renderAsync();
    return rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  },
};
