import { useId, useRef, useState } from "react";
import { ExternalLinkIcon, GlobeIcon, ImageIcon, PencilIcon } from "lucide-react";

import { imageInputAccept } from "../media/imageFileTypes";
import { useImageUpload } from "../media/useImageUpload";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { readEmbedAddress, viewEmbed } from "./noteEmbed";

/**
 * Frames get scripts and their own origin, which a page needs to work, but
 * nothing of the app's: they can't navigate it, and popups open in the browser.
 */
const FRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation";

function AddressForm({
  initial,
  onEmbed,
  onCancel,
}: {
  initial: string;
  onEmbed: (address: string) => void;
  onCancel?: () => void;
}) {
  const inputId = useId();
  const [typed, setTyped] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { uploadImage } = useImageUpload();

  const submit = () => {
    const address = readEmbedAddress(typed);
    if (address) onEmbed(address);
    else setError("Enter an https address, such as example.com.");
  };

  return (
    <form
      className="mx-auto flex w-full max-w-lg flex-col gap-3 py-16"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor={inputId} className="text-sm font-medium text-(--app-text)">
        Web page or image address
      </label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={typed}
          autoFocus
          placeholder="example.com"
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setTyped(event.target.value);
            setError(null);
          }}
        />
        <Button type="submit" size="sm">
          Embed
        </Button>
      </div>
      {error ? <p className="text-xs text-(--status-danger)">{error}</p> : null}
      <div className="flex items-center gap-2 text-xs text-(--app-muted)">
        <span>or</span>
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <ImageIcon className="size-3.5" />
          Choose an image…
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost-muted" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
      <input
        ref={fileRef}
        type="file"
        hidden
        accept={imageInputAccept}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          const saved = file ? await uploadImage(file) : null;
          if (saved) onEmbed(saved.path);
        }}
      />
      <p className="text-xs text-(--app-muted)">
        Pages load from the web each time the tab opens. Some sites don&apos;t allow being shown
        inside other apps.
      </p>
    </form>
  );
}

/** A tab showing one web page or image, from the address it keeps. */
export function EmbedTab({
  address,
  onChange,
}: {
  address: string;
  onChange: (address: string) => void;
}) {
  const [changing, setChanging] = useState(false);
  const view = address ? viewEmbed(address) : null;

  if (!view || changing) {
    return (
      <AddressForm
        initial={address}
        onEmbed={(next) => {
          onChange(next);
          setChanging(false);
        }}
        onCancel={view ? () => setChanging(false) : undefined}
      />
    );
  }

  return (
    <div className="flex w-full flex-col">
      <div className="flex h-9 items-center gap-2 border-b border-(--app-border) px-3 text-xs text-(--app-muted)">
        {view.type === "page" ? (
          <GlobeIcon aria-hidden className="size-3.5 shrink-0" />
        ) : (
          <ImageIcon aria-hidden className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{view.address ?? "Image"}</span>
        {view.address ? (
          <Button
            type="button"
            variant="ghost-muted"
            size="sm"
            // The app opens every new window in the browser.
            onClick={() => window.open(view.address!, "_blank", "noopener")}
          >
            <ExternalLinkIcon className="size-3.5" />
            Open in browser
          </Button>
        ) : null}
        <Button type="button" variant="ghost-muted" size="sm" onClick={() => setChanging(true)}>
          <PencilIcon className="size-3.5" />
          Change
        </Button>
      </div>
      {view.type === "page" ? (
        <iframe
          title={`Embedded page: ${view.address}`}
          src={view.src}
          sandbox={FRAME_SANDBOX}
          allow="fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          className="h-[calc(100vh-14rem)] min-h-[28rem] w-full border-0 bg-white"
        />
      ) : (
        <div className="flex justify-center p-4">
          <img
            src={view.src}
            alt={view.address ?? "Embedded image"}
            className="max-h-[calc(100vh-15rem)] max-w-full object-contain"
          />
        </div>
      )}
    </div>
  );
}
