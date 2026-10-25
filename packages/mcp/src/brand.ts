/** The Appdyno logo: the server's icon. */
export const APPDYNO_LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#5D3EBC"/><path d="M8 20h9l4-6h4" fill="none" stroke="#FFD300" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="23" r="3" fill="#FFD300"/><circle cx="23" cy="23" r="3" fill="#FFD300"/><rect x="6" y="9" width="9" height="8" rx="2" fill="#FFD300"/></svg>';

export const SERVER_INFO = {
  name: 'appdyno',
  title: 'appdyno',
  version: '0.1.0',
  icons: [
    {
      src: `data:image/svg+xml;base64,${Buffer.from(APPDYNO_LOGO_SVG).toString('base64')}`,
      mimeType: 'image/svg+xml',
      sizes: ['any'],
    },
  ],
};

export const INSTRUCTIONS =
  'appdyno: bir mobil cihazı sürer. Önce screen ile oku; öğelere ref ile dokun (tap, type_text). ' +
  'Her eylem ekranın son halini döndürür (read: diff varsayılan), ayrıca okumaya gerek yok. ' +
  'Sabit bekleme yok: wait_for kullan. Ekran görüntüsünü yalnız görsel bir yargı için al.';
