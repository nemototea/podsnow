import { useServices } from '@/features/app/ServicesProvider';
import { usePlayback } from '@/features/player/usePlayback';
import { errorCodeText, useT } from '@/i18n';
import { EpisodePlayer } from '@/ui/EpisodePlayer';
import { Screen } from '@/ui/components';

export default function PlayerScreen() {
  const services = useServices();
  const player = usePlayback();
  const t = useT();
  const source = player.source?.homeKey ? player.source : null;
  if (!source) return <Screen>{null}</Screen>;
  return (
    <Screen>
      <EpisodePlayer
        medium={source.kind === 'timeline' ? 'tape' : 'disc'}
        artworkUri={services.coverArt.uri(services.show.cover_path)}
        showName={services.show.name}
        title={source.title || t.home.untitled}
        episodeNumber={source.episodeNumber ?? null}
        position={player.position}
        duration={player.duration}
        playing={player.playing}
        loading={player.loading}
        loadingLabel={source.kind === 'rss' ? t.player.loadingStream : t.player.loadingFile}
        errorMessage={player.error ? errorCodeText(t, player.error) : null}
        onToggle={() => void player.toggleCurrent()}
        onSeek={(to) => void player.seek(to)}
      />
    </Screen>
  );
}
