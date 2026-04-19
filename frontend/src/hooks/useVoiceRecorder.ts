import { useState, useRef, useCallback, useEffect } from "react";

export interface RecordingResult {
  blob: Blob;
  url: string;
  durationMs: number;
}

/**
 * Negotiate a supported audio mimeType for MediaRecorder.
 */
function negotiateMimeType(): string | undefined {
  if (
    typeof MediaRecorder !== "undefined" &&
    typeof MediaRecorder.isTypeSupported === "function"
  ) {
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
      return "audio/webm;codecs=opus";
    }
    if (MediaRecorder.isTypeSupported("audio/mp4")) {
      return "audio/mp4";
    }
  }
  return undefined;
}

// ── Shared mic session (module-level singleton) ──────────────────────
// Kept alive across question transitions so iOS Safari doesn't re-show
// the "Microphone access allowed" banner on every question.
let sharedStream: MediaStream | null = null;
let sharedAudioCtx: AudioContext | null = null;
let sharedAnalyser: AnalyserNode | null = null;
let streamRefCount = 0;

async function acquireSharedStream(): Promise<{
  stream: MediaStream;
  analyser: AnalyserNode;
} | null> {
  // Reuse existing live stream
  if (sharedStream?.active && sharedAudioCtx && sharedAnalyser) {
    streamRefCount++;
    return { stream: sharedStream, analyser: sharedAnalyser };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    sharedStream = stream;

    const audioCtx = new AudioContext();
    sharedAudioCtx = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 512;
    analyserNode.smoothingTimeConstant = 0.8;
    source.connect(analyserNode);
    sharedAnalyser = analyserNode;

    streamRefCount++;
    return { stream, analyser: analyserNode };
  } catch {
    return null;
  }
}

function releaseSharedStream() {
  streamRefCount = Math.max(0, streamRefCount - 1);
  // Don't actually tear down — keep alive for next question.
  // Only fully release via forceReleaseSharedStream().
}

/** Call when completely done with mic (leaving question flow). */
export function forceReleaseSharedStream() {
  sharedStream?.getTracks().forEach((t) => t.stop());
  sharedStream = null;
  sharedAudioCtx?.close();
  sharedAudioCtx = null;
  sharedAnalyser = null;
  streamRefCount = 0;
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [mimeType, setMimeType] = useState<string | undefined>(undefined);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const activeMimeRef = useRef<string | undefined>(undefined);

  // On unmount, decrement ref count (but don't kill the stream)
  useEffect(() => {
    return () => {
      releaseSharedStream();
    };
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    const result = await acquireSharedStream();
    if (!result) {
      setPermissionDenied(true);
      return false;
    }

    setPermissionDenied(false);
    setAnalyser(result.analyser);

    const negotiated = negotiateMimeType();
    const options: MediaRecorderOptions = {};
    if (negotiated) options.mimeType = negotiated;

    const mr = new MediaRecorder(result.stream, options);
    const actualMime = mr.mimeType || negotiated;
    activeMimeRef.current = actualMime;
    setMimeType(actualMime);

    mediaRecorderRef.current = mr;
    chunksRef.current = [];
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.start(100);
    startTimeRef.current = Date.now();
    setIsRecording(true);
    return true;
  }, []);

  const stop = useCallback((): Promise<RecordingResult> => {
    return new Promise((resolve) => {
      const mr = mediaRecorderRef.current;
      if (!mr || mr.state === "inactive") {
        resolve({ blob: new Blob(), url: "", durationMs: 0 });
        setIsRecording(false);
        return;
      }

      mr.onstop = () => {
        const blobMime = activeMimeRef.current || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: blobMime });
        const url = URL.createObjectURL(blob);
        const durationMs = Date.now() - startTimeRef.current;
        resolve({ blob, url, durationMs });
      };

      mr.stop();
      setIsRecording(false);
      // Stream stays alive for the next question
    });
  }, []);

  return { isRecording, analyser, permissionDenied, mimeType, start, stop };
}
