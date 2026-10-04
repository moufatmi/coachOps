import { cn } from "@/lib/utils";

interface Props {
  photo?: string;
  name: string;
  jerseyNumber?: number;
  className?: string;
  /** Ring colour, used to keep the captain readable over a photo. */
  ring?: string;
}

/**
 * A player's face, or their shirt number when there is no photo.
 *
 * Used wherever a player is represented by a circle: the pitch, the bench, the
 * squad list, the attendance tiles. Falling back to the jersey number rather than
 * initials means the marker still reads as "who is this" on a pitch where 48px
 * circles sit next to each other.
 */
export default function PlayerAvatar({ photo, name, jerseyNumber, className, ring }: Props) {
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-900 font-black text-white",
        className,
        ring,
      )}
      title={name}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span>{jerseyNumber != null ? `#${jerseyNumber}` : name.slice(0, 1)}</span>
      )}
    </span>
  );
}