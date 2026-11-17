/**
 * The Turkish words that took the place of a term kept in English, as CONTRIBUTING lists them: a host, a cold or warm
 * launch, a runner, a deep link, a crash, a flow's setup and teardown.
 */
export const REPLACED_IN_TURKISH =
  /\bana makine|\b(soğuk|sıcak|ılık) açılış|çalıştırıcı|derin bağlantı|\bçökme(ler| rapor)|kurulum ve temizlik/i;

/** The terms kept in English, as a Turkish word of the Mac app keeps one its English names. */
export const KEPT_IN_ENGLISH = [
  'cold launch',
  'warm launch',
  'crash',
  'flow',
  'runner',
  'deep link',
  'host',
  'simulator',
  'emulator',
];
