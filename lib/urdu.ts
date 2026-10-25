/** Urdu-script or Roman-Urdu input detection — drives reply language (C.13). */
export function isUrdu(text: string): boolean {
  if (/[\u0600-\u06FF]/.test(text)) return true;
  return /(chh?utt?i|chh?uttee|mujhe|meri\s|mera\s|kitn|batao|batayen|tanq?w|tankhw|balens)/i.test(text);
}
