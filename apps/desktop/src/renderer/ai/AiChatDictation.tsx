import { useEffect, useRef, useState } from "react";
import { MicIcon, SquareIcon } from "lucide-react";

import { callBridge } from "../bridge";
import { errorMessage } from "../lib/errorMessage";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { DotMatrixLoader } from "../ui/DotMatrixLoader";
import { toastError } from "../ui/toast";

import styles from "./aiChat.module.css";

/** The longest recording, which stays under what transcription takes in one go. */
const MAX_RECORDING_MS = 10 * 60 * 1000;
const BARS = 5;

type State = { kind: "idle" } | { kind: "recording"; since: number } | { kind: "writing" };

const formatElapsed = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/**
 * Speaking a message: the first click records from the microphone, the
 * second stops and writes what was said into the message. While it records,
 * bars move with the voice and the time counts up.
 */
export function AiChatDictation({
  disabled,
  onText,
}: {
  disabled: boolean;
  onText: (text: string) => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const recorder = useRef<MediaRecorder | null>(null);
  const bars = useRef<HTMLSpanElement | null>(null);
  const latestOnText = useRef(onText);
  useEffect(() => {
    latestOnText.current = onText;
  });

  // Stops the microphone if the composer goes while recording.
  useEffect(
    () => () => {
      const active = recorder.current;
      if (active && active.state !== "inactive") {
        active.onstop = null;
        active.stop();
      }
    },
    [],
  );

  // The time counts up while recording, and the recording ends on its own at the limit.
  useEffect(() => {
    if (state.kind !== "recording") return;
    const tick = setInterval(() => {
      setNow(Date.now());
      if (Date.now() - state.since > MAX_RECORDING_MS) recorder.current?.stop();
    }, 250);
    return () => clearInterval(tick);
  }, [state]);

  const start = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toastError("The microphone isn't available.", {
        description: "Allow Loam to use it in your system's privacy settings.",
      });
      return;
    }
    const chunks: Blob[] = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "";
    const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.current = media;

    // The bars follow how loud the voice is, drawn straight into their style.
    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 256;
    audio.createMediaStreamSource(stream).connect(analyser);
    const levels = new Uint8Array(analyser.frequencyBinCount);
    let frame = requestAnimationFrame(function draw() {
      analyser.getByteFrequencyData(levels);
      const span = Math.floor(levels.length / BARS);
      bars.current?.childNodes.forEach((node, index) => {
        let sum = 0;
        for (let bin = index * span; bin < (index + 1) * span; bin++) sum += levels[bin]!;
        const level = Math.min(1, sum / span / 160);
        (node as HTMLElement).style.transform = `scaleY(${0.2 + level * 0.8})`;
      });
      frame = requestAnimationFrame(draw);
    });

    media.ondataavailable = (event) => chunks.push(event.data);
    media.onstop = () => {
      cancelAnimationFrame(frame);
      void audio.close();
      for (const track of stream.getTracks()) track.stop();
      setState({ kind: "writing" });
      const type = media.mimeType || "audio/webm";
      new Blob(chunks, { type })
        .arrayBuffer()
        .then((buffer) =>
          callBridge("ai.transcribe", { audio: new Uint8Array(buffer), mimeType: type }),
        )
        .then(
          ({ text }) => {
            if (text) latestOnText.current(text);
          },
          (error: unknown) =>
            toastError("Couldn't write down what was said", { description: errorMessage(error) }),
        )
        .finally(() => setState({ kind: "idle" }));
    };
    media.start();
    setNow(Date.now());
    setState({ kind: "recording", since: Date.now() });
  };

  if (state.kind === "writing")
    return (
      <span
        className="inline-flex size-8 items-center justify-center text-(--app-muted)"
        role="status"
        aria-label="Writing down what was said"
      >
        <DotMatrixLoader />
      </span>
    );

  if (state.kind === "recording")
    return (
      <Button
        variant="ghost"
        size="sm"
        className={cn("min-w-0 gap-1.5 px-2 text-(--status-danger)", styles.swapIn)}
        aria-label="Stop and write it down"
        onClick={() => recorder.current?.stop()}
      >
        <span ref={bars} className="flex h-3.5 items-center gap-[2px]" aria-hidden>
          {Array.from({ length: BARS }, (_, index) => (
            <span key={index} className={styles.voiceBar} />
          ))}
        </span>
        <span className="tabular-nums">{formatElapsed(now - state.since)}</span>
        <SquareIcon className="size-3 fill-current" aria-hidden />
      </Button>
    );

  return (
    <Button
      variant="ghost-muted"
      size="icon-sm"
      aria-label="Dictate"
      disabled={disabled}
      onClick={() => void start()}
    >
      <MicIcon aria-hidden />
    </Button>
  );
}
