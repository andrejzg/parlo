import { customAlphabet } from "nanoid";

const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";

const nanoid = customAlphabet(alphabet);

export function generateCode(length: number = 8): string {
  return nanoid(length);
}

export function generateId(): string {
  return nanoid(21);
}
