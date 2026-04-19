/**
 * Merges multiple audio Blobs into a single WAV Blob.
 * Uses AudioContext to decode each blob, concatenates the PCM data,
 * and encodes the result as uncompressed WAV.
 */
export async function mergeAudioBlobs(
  blobs: Blob[]
): Promise<{ blob: Blob; url: string; durationMs: number }> {
  if (blobs.length === 0) throw new Error("No blobs to merge");

  if (blobs.length === 1) {
    return {
      blob: blobs[0],
      url: URL.createObjectURL(blobs[0]),
      durationMs: await getBlobDurationMs(blobs[0]),
    };
  }

  const audioCtx = new AudioContext();
  try {
    const buffers = await Promise.all(
      blobs.map((b) =>
        b.arrayBuffer().then((ab) => audioCtx.decodeAudioData(ab))
      )
    );

    const sampleRate = buffers[0].sampleRate;
    const numChannels = Math.max(...buffers.map((b) => b.numberOfChannels));
    const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
    const totalDurationMs = buffers.reduce((sum, b) => sum + b.duration * 1000, 0);

    const bytesPerSample = 2; // 16-bit PCM
    const dataSize = totalLength * numChannels * bytesPerSample;
    const arrayBuf = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arrayBuf);

    // WAV header
    writeStr(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(view, 8, "WAVE");
    writeStr(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeStr(view, 36, "data");
    view.setUint32(40, dataSize, true);

    // Interleave audio data
    let offset = 44;
    for (const buf of buffers) {
      for (let i = 0; i < buf.length; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
          const chData =
            ch < buf.numberOfChannels
              ? buf.getChannelData(ch)
              : buf.getChannelData(0);
          const sample = Math.max(-1, Math.min(1, chData[i]));
          view.setInt16(offset, sample * 0x7fff, true);
          offset += 2;
        }
      }
    }

    const wavBlob = new Blob([arrayBuf], { type: "audio/wav" });
    return {
      blob: wavBlob,
      url: URL.createObjectURL(wavBlob),
      durationMs: totalDurationMs,
    };
  } finally {
    await audioCtx.close();
  }
}

function writeStr(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

async function getBlobDurationMs(blob: Blob): Promise<number> {
  const audioCtx = new AudioContext();
  try {
    const ab = await blob.arrayBuffer();
    const buf = await audioCtx.decodeAudioData(ab);
    return buf.duration * 1000;
  } finally {
    await audioCtx.close();
  }
}
