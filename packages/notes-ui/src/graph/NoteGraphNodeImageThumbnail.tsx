import { RemoteAwareImage } from "../media/RemoteAwareImage";
import { useImageUrl } from "../media/useImageUrl";

export function NoteGraphNodeImageThumbnail({
  imageUrl,
  title,
}: {
  imageUrl: string;
  title: string;
}) {
  const { url } = useImageUrl(imageUrl);
  if (!url) {
    return (
      <div className="size-12 shrink-0 animate-pulse rounded border border-(--app-border)/60 bg-(--app-page-2)" />
    );
  }
  return (
    <div className="relative size-12 shrink-0 overflow-hidden rounded border border-(--app-border)/60">
      <RemoteAwareImage
        alt={title.trim() || "Node image"}
        className="object-cover"
        draggable={false}
        sizes="48px"
        src={url}
      />
    </div>
  );
}
