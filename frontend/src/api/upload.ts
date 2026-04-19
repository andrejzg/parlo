/**
 * Upload a Blob (audio, image, or video) to a presigned R2 URL.
 * Returns true on success, throws on failure.
 *
 * Uses XMLHttpRequest so we can expose upload progress events — this matters
 * for video answers (~10MB+) where we want to show a progress bar. The fetch
 * API doesn't expose upload progress on the web (it does in Workers, but not
 * in browsers).
 *
 * Content-Type defaults to audio/webm for backwards compat. The blob's own
 * .type usually carries the right value (image/jpeg, video/mp4, etc.).
 */
export async function uploadAudioBlob(
  presignedUrl: string,
  blob: Blob,
  onProgress?: (pct: number) => void,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", presignedUrl);
    xhr.setRequestHeader("Content-Type", blob.type || "audio/webm");

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress((e.loaded / e.total) * 100);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(true);
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.onabort = () => reject(new Error("Upload aborted"));

    xhr.send(blob);
  });
}
