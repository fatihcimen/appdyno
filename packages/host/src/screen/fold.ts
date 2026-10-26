/**
 * A text for matching in any language: accents and dots dropped, lower case without a locale ("INFO"
 * finds "info", "İstanbul" finds "istanbul", the dotless ı matches i).
 */
export const fold = (s: string) =>
  s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ı/g, 'i');
