import { Loader2, SlidersHorizontal } from "lucide-react";
import { cn } from "../../../../lib/utils";

export function AvatarRemoveButton({
  characterName,
  pending = false,
  className,
  onRemove,
}: {
  characterName: string;
  pending?: boolean;
  className?: string;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
      disabled={pending}
      title={`Open ${characterName} avatar body controls`}
      aria-label={`Open ${characterName} avatar body controls`}
      className={cn(
        "group/remove-avatar absolute z-[8] flex h-11 w-11 items-start justify-end rounded-full p-1 text-[var(--destructive)] opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--destructive)] disabled:cursor-wait [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/avatar-shell:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100",
        className,
      )}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--destructive)]/45 bg-[var(--background)]/92 shadow-md backdrop-blur-sm transition-colors group-hover/remove-avatar:bg-[var(--destructive)] group-hover/remove-avatar:text-white group-active/remove-avatar:scale-90">
        {pending ? <Loader2 size="0.75rem" className="animate-spin" /> : <SlidersHorizontal size="0.75rem" />}
      </span>
    </button>
  );
}
