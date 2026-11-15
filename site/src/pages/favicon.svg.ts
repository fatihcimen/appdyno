import { SERVER_ICON } from '../../../scripts/icon-art.mjs';

/** The mark, from where every icon of appdyno is drawn. */
export const GET = () =>
  new Response(SERVER_ICON, { headers: { 'Content-Type': 'image/svg+xml' } });
