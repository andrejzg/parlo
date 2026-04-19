import { initializeApp } from "firebase/app";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Invisible reCAPTCHA verifier — attach to a button element
let recaptchaVerifier: RecaptchaVerifier | null = null;

export function getRecaptchaVerifier(buttonId: string): RecaptchaVerifier {
  if (recaptchaVerifier) {
    recaptchaVerifier.clear();
  }
  recaptchaVerifier = new RecaptchaVerifier(auth, buttonId, { size: "invisible" });
  return recaptchaVerifier;
}

export async function sendOtp(phone: string, buttonId: string): Promise<ConfirmationResult> {
  const verifier = getRecaptchaVerifier(buttonId);
  return signInWithPhoneNumber(auth, phone, verifier);
}

export type { ConfirmationResult };
