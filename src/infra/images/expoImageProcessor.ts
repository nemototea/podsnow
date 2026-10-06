import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { ImageProcessorPort } from '@/services/shows/ImageProcessorPort';

import { decodePng } from './decodePng';

function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

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

  // 画素は直接取れないので、縮めた PNG を base64 で受け取って展開する
  // （expo-image-manipulator 57.0.20 の型定義で確認。ImageRef.saveAsync の format / base64）。
  async samplePixels(source, size) {
    const context = ImageManipulator.manipulate(source);
    context.resize({ width: size, height: size });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.PNG, base64: true });
    if (!saved.base64) throw new Error('samplePixels: no base64');
    return { rgba: decodePng(base64Bytes(saved.base64)).rgba, uri: saved.uri };
  },
};
