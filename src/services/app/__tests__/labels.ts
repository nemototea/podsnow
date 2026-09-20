import type { ServiceLabels } from '../labels';

/** テスト用の既定文言（Issue #80）。本番の文言は `src/i18n/` のカタログ。 */
export const TEST_LABELS: ServiceLabels = {
  showName: 'Test Show',
  descriptionTemplate: '{{topics}}\n\nPodcast: {{show_name}}',
  takeName: (n) => `Recording ${n}`,
  interruptionMarker: 'interrupted',
  androidNotification: {
    title: 'Rec',
    text: 'Tap',
    channelName: 'Recording',
    channelDescription: 'While recording',
  },
};

/** `ensureDefaultShow` に渡す seed。 */
export const TEST_SHOW_SEED = {
  name: TEST_LABELS.showName,
  descriptionTemplate: TEST_LABELS.descriptionTemplate,
};
