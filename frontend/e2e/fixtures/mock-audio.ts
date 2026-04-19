import type { Page } from "@playwright/test";

export interface AudioMockOptions {
  /** When true, getUserMedia rejects with NotAllowedError */
  denyPermission?: boolean;
}

/**
 * Injects fake MediaRecorder, getUserMedia, and AudioContext into the page
 * before the app loads. Must be called before page.goto().
 */
export async function injectAudioMocks(
  page: Page,
  options: AudioMockOptions = {},
) {
  const { denyPermission = false } = options;

  await page.addInitScript(
    ({ denyPermission }) => {
      // --- Fake MediaStream & MediaStreamTrack ---

      class FakeMediaStreamTrack {
        kind = "audio";
        id = crypto.randomUUID();
        label = "Fake Audio Track";
        enabled = true;
        readyState: "live" | "ended" = "live";
        muted = false;

        stop() {
          this.readyState = "ended";
        }

        getSettings() {
          return { channelCount: 1, sampleRate: 48000 };
        }

        clone() {
          return new FakeMediaStreamTrack();
        }

        addEventListener() {}
        removeEventListener() {}
        dispatchEvent() {
          return true;
        }
      }

      class FakeMediaStream {
        id = crypto.randomUUID();
        active = true;
        private tracks = [new FakeMediaStreamTrack()];

        getTracks() {
          return [...this.tracks];
        }
        getAudioTracks() {
          return [...this.tracks];
        }
        getVideoTracks(): never[] {
          return [];
        }
        addTrack(t: FakeMediaStreamTrack) {
          this.tracks.push(t);
        }
        removeTrack(t: FakeMediaStreamTrack) {
          this.tracks = this.tracks.filter((x) => x !== t);
        }
        clone() {
          return new FakeMediaStream();
        }
        addEventListener() {}
        removeEventListener() {}
        dispatchEvent() {
          return true;
        }
      }

      // --- getUserMedia ---

      const fakeGetUserMedia = async (
        _constraints?: MediaStreamConstraints,
      ): Promise<MediaStream> => {
        if (denyPermission) {
          const err = new DOMException(
            "Permission denied",
            "NotAllowedError",
          );
          throw err;
        }
        return new FakeMediaStream() as unknown as MediaStream;
      };

      if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia = fakeGetUserMedia;
      } else {
        Object.defineProperty(navigator, "mediaDevices", {
          value: { getUserMedia: fakeGetUserMedia },
          writable: true,
        });
      }

      // --- Fake MediaRecorder ---

      class FakeMediaRecorder extends EventTarget {
        state: "inactive" | "recording" | "paused" = "inactive";
        stream: MediaStream;
        mimeType = "audio/webm";
        private timerId: ReturnType<typeof setInterval> | null = null;

        // Event handler properties
        ondataavailable: ((ev: Event) => void) | null = null;
        onstop: ((ev: Event) => void) | null = null;
        onstart: ((ev: Event) => void) | null = null;
        onerror: ((ev: Event) => void) | null = null;
        onpause: ((ev: Event) => void) | null = null;
        onresume: ((ev: Event) => void) | null = null;

        constructor(stream: MediaStream, _options?: MediaRecorderOptions) {
          super();
          this.stream = stream;
        }

        static isTypeSupported(mimeType: string): boolean {
          return mimeType.startsWith("audio/webm");
        }

        start(_timeslice?: number) {
          this.state = "recording";
          const startEvent = new Event("start");
          this.onstart?.(startEvent);
          this.dispatchEvent(startEvent);

          this.timerId = setInterval(() => {
            this.emitData();
          }, 500);
        }

        stop() {
          if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
          }
          this.emitData();
          this.state = "inactive";
          const stopEvent = new Event("stop");
          this.onstop?.(stopEvent);
          this.dispatchEvent(stopEvent);
        }

        pause() {
          if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
          }
          this.state = "paused";
          const ev = new Event("pause");
          this.onpause?.(ev);
          this.dispatchEvent(ev);
        }

        resume() {
          this.state = "recording";
          this.timerId = setInterval(() => {
            this.emitData();
          }, 500);
          const ev = new Event("resume");
          this.onresume?.(ev);
          this.dispatchEvent(ev);
        }

        requestData() {
          this.emitData();
        }

        private emitData() {
          // Tiny valid blob
          const blob = new Blob([new Uint8Array([0, 0, 0, 0])], {
            type: "audio/webm",
          });
          const ev = new MessageEvent("dataavailable", {
            data: blob,
          }) as unknown as BlobEvent;
          // BlobEvent isn't easily constructible, so we attach data manually
          Object.defineProperty(ev, "data", { value: blob });
          this.ondataavailable?.(ev);
          this.dispatchEvent(ev);
        }
      }

      Object.defineProperty(window, "MediaRecorder", {
        value: FakeMediaRecorder,
        writable: true,
      });

      // --- Fake AudioContext / OfflineAudioContext ---

      class FakeAnalyserNode {
        fftSize = 2048;
        frequencyBinCount = 1024;
        minDecibels = -100;
        maxDecibels = -30;
        smoothingTimeConstant = 0.8;

        getByteTimeDomainData(array: Uint8Array) {
          array.fill(128);
        }
        getFloatTimeDomainData(array: Float32Array) {
          array.fill(0);
        }
        getByteFrequencyData(array: Uint8Array) {
          array.fill(0);
        }
        getFloatFrequencyData(array: Float32Array) {
          array.fill(-Infinity);
        }
        connect() {
          return this;
        }
        disconnect() {}
      }

      class FakeGainNode {
        gain = { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} };
        connect() {
          return this;
        }
        disconnect() {}
      }

      class FakeAudioContext {
        state: "running" | "suspended" | "closed" = "running";
        sampleRate = 48000;
        currentTime = 0;
        destination = {};

        createAnalyser() {
          return new FakeAnalyserNode();
        }
        createGain() {
          return new FakeGainNode();
        }
        createMediaStreamSource() {
          return {
            connect() {
              return this;
            },
            disconnect() {},
          };
        }
        createOscillator() {
          return {
            frequency: { value: 440 },
            connect() {
              return this;
            },
            disconnect() {},
            start() {},
            stop() {},
          };
        }
        resume() {
          this.state = "running";
          return Promise.resolve();
        }
        suspend() {
          this.state = "suspended";
          return Promise.resolve();
        }
        close() {
          this.state = "closed";
          return Promise.resolve();
        }
        decodeAudioData() {
          return Promise.resolve({
            duration: 1,
            length: 48000,
            sampleRate: 48000,
            numberOfChannels: 1,
            getChannelData: () => new Float32Array(48000),
          });
        }
      }

      class FakeOfflineAudioContext extends FakeAudioContext {
        startRendering() {
          return Promise.resolve({
            duration: 1,
            length: 48000,
            sampleRate: 48000,
            numberOfChannels: 1,
            getChannelData: () => new Float32Array(48000),
          });
        }
      }

      Object.defineProperty(window, "AudioContext", {
        value: FakeAudioContext,
        writable: true,
      });
      Object.defineProperty(window, "webkitAudioContext", {
        value: FakeAudioContext,
        writable: true,
      });
      Object.defineProperty(window, "OfflineAudioContext", {
        value: FakeOfflineAudioContext,
        writable: true,
      });
    },
    { denyPermission },
  );
}
