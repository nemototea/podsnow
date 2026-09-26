import { useServices } from '@/features/app/ServicesProvider';
import { usePlayback } from '@/features/player/usePlayback';
import { useT } from '@/i18n';
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
        artworkUri={services.coverArt.uri(services.show.cover_path)}
        title={source.title || t.home.untitled}
        episodeNumber={source.episodeNumber ?? null}
        position={player.position}
        duration={player.duration}
        playing={player.playing}
        onToggle={() => void player.toggleCurrent()}
        onSeek={(to) => void player.seek(to)}
      />
    </Screen>
  );
}
