import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLinkIcon } from "lucide-react";

import type { BridgeGoogleStatus } from "@loam/shared/google/googleAccount";

import { callBridge, onBridgeEvent } from "../bridge";
import { errorMessage } from "@loam/notes-ui/lib/errorMessage";
import { Button } from "@loam/notes-ui/ui/Button";
import { Input } from "@loam/notes-ui/ui/Input";
import { toastError } from "@loam/notes-ui/ui/toast";

const GOOGLE_KEY = ["google"];

/** How to make the OAuth client, step by step. */
const SETUP_GUIDE = "https://github.com/ramon427/loam/blob/main/docs/google-calendar.md";

const useGoogleStatus = () => {
  const queryClient = useQueryClient();
  useEffect(
    () => onBridgeEvent("google.status", (status) => queryClient.setQueryData(GOOGLE_KEY, status)),
    [queryClient],
  );
  return useQuery({ queryKey: GOOGLE_KEY, queryFn: () => callBridge("google.status", {}) });
};

const describe = (status: BridgeGoogleStatus) => {
  switch (status.state) {
    case "signed-in":
      return status.email ? `Signed in as ${status.email}` : "Signed in";
    case "signing-in":
      return "Finish signing in in your browser…";
    case "expired":
      return "Signed out by Google";
    default:
      return "Not signed in";
  }
};

/**
 * The Google account plugins granted google:calendar use: the OAuth client the user made in
 * Google Cloud (its secret is kept encrypted and never shown again), and signing in or out.
 */
export function GoogleAccountSettings() {
  const queryClient = useQueryClient();
  const status = useGoogleStatus().data;
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  useEffect(() => setClientId(status?.clientId ?? ""), [status?.clientId]);

  const save = (status: BridgeGoogleStatus) => queryClient.setQueryData(GOOGLE_KEY, status);
  const configure = useMutation({
    mutationFn: (client: { clientId: string; clientSecret?: string | null }) =>
      callBridge("google.configure", client),
    onSuccess: (next) => {
      save(next);
      setSecret("");
    },
    onError: (error) =>
      toastError("The Google client could not be saved.", { description: errorMessage(error) }),
  });
  const signIn = useMutation({
    mutationFn: () => callBridge("google.signIn", {}),
    onSuccess: save,
    onError: (error) =>
      toastError("Signing in to Google failed.", { description: errorMessage(error) }),
  });
  const signOut = useMutation({
    mutationFn: () => callBridge("google.signOut", {}),
    onSuccess: save,
  });

  if (!status) return null;
  const busy = configure.isPending || signOut.isPending;
  const signedIn = status.state === "signed-in";
  const signingIn = status.state === "signing-in";

  return (
    <section
      aria-label="Google account"
      className="flex flex-col gap-2 rounded-(--radius-control) border border-(--app-border) p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-(--app-text)">Google account</div>
          <div className="text-[11px] text-(--app-muted)" data-testid="google-account-status">
            {describe(status)}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {signingIn ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void callBridge("google.cancelSignIn", {})}
            >
              Cancel
            </Button>
          ) : signedIn ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => signOut.mutate()}>
              Sign out
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy || !status.clientId || !status.canEncrypt}
              onClick={() => signIn.mutate()}
            >
              Sign in with Google
            </Button>
          )}
        </div>
      </div>
      {status.error ? (
        <p role="alert" className="m-0 text-[11px] text-(--status-danger)">
          {status.error}
        </p>
      ) : null}
      {!status.canEncrypt ? (
        <p className="m-0 text-[11px] text-(--status-danger)">
          This computer can't encrypt the sign-in (it has no keychain), so Loam can't keep it.
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-4">
        <label htmlFor="google-client-id" className="text-xs text-(--app-text)">
          Client ID
        </label>
        <Input
          id="google-client-id"
          className="w-72"
          autoComplete="off"
          spellCheck={false}
          placeholder="….apps.googleusercontent.com"
          value={clientId}
          disabled={busy || signingIn}
          onChange={(event) => setClientId(event.target.value)}
          onBlur={() => {
            if (clientId.trim() !== (status.clientId ?? "")) configure.mutate({ clientId });
          }}
        />
      </div>
      <form
        className="flex items-center justify-between gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (secret.trim()) configure.mutate({ clientId, clientSecret: secret });
        }}
      >
        <label htmlFor="google-client-secret" className="text-xs text-(--app-text)">
          Client secret
        </label>
        <div className="flex items-center gap-1.5">
          <Input
            id="google-client-secret"
            type="password"
            className="w-48"
            autoComplete="off"
            value={secret}
            disabled={busy || signingIn}
            placeholder={status.hasClientSecret ? "Saved; paste to replace" : "Paste the secret"}
            onChange={(event) => setSecret(event.target.value)}
          />
          <Button type="submit" size="sm" variant="outline" disabled={busy || !secret.trim()}>
            Save
          </Button>
        </div>
      </form>
      <p className="m-0 text-[11px] text-(--app-muted)">
        Make a Desktop app OAuth client in your own Google Cloud project and paste it here. Loam
        keeps the sign-in encrypted on this computer and only reaches Google Calendar with it.{" "}
        <a
          href={SETUP_GUIDE}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-0.5 text-(--app-accent) underline-offset-2 hover:underline"
        >
          How to set it up
          <ExternalLinkIcon className="size-3" aria-hidden />
        </a>
      </p>
    </section>
  );
}
