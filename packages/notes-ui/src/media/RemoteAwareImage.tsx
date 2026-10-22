import { useState } from "react";

type RemoteAwareImageProps = {
  /** A display URL, usually from `mediaSrc`; nothing renders when it's empty. */
  src: string;
  alt: string;
  sizes?: string;
  className?: string;
  draggable?: boolean;
  onError?: () => void;
};

/** An image that fills its positioned parent and fades in once it has loaded. */
export const RemoteAwareImage = ({
  src,
  alt,
  sizes,
  className,
  draggable = false,
  onError,
}: RemoteAwareImageProps) => {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  if (!src) return null;

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      draggable={draggable}
      onError={onError}
      onLoad={() => setLoadedSrc(src)}
      decoding="async"
      sizes={sizes}
      style={{
        height: "100%",
        left: 0,
        opacity: loadedSrc === src ? undefined : 0,
        position: "absolute",
        top: 0,
        transition: "opacity 150ms ease-in",
        width: "100%",
      }}
    />
  );
};
