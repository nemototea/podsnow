import type { ServiceLabels } from '../labels';

/** テスト用の既定文言（Issue #80）。本番の文言は `src/i18n/` のカタログ。 */
export const TEST_LABELS: ServiceLabels = {
  showName: 'Test Show',
  descriptionTemplate: '{{topics}}\n\nPodcast: {{show_name}}',
  takeName: (n) => `Recording ${n}`,
  addTakeOp: (take) => `Add ${take}`,
  interruptionNote: 'interrupted',
  androidNotification: {
    title: 'Rec',
    text: 'Tap',
    channelName: 'Recording',
    channelDescription: 'While recording',
  },
  nowPlaying: {
    untitled: 'Untitled',
    play: 'Play',
    pause: 'Pause',
    rewind: 'Back 15',
    forward: 'Forward 30',
    stop: 'Stop',
    channelName: 'Playback',
    channelDescription: 'While playing',
  },
};

/** `ensureDefaultShow` に渡す seed。 */
export const TEST_SHOW_SEED = {
  name: TEST_LABELS.showName,
  descriptionTemplate: TEST_LABELS.descriptionTemplate,
};
