/**
 * What the page does, as text: it travels inside the file and is allowed by its hash alone, so the only script that can
 * run on a page holding a device's text is this one. Two parts, so that a test runs the first with no page around it.
 */

/** What was happening at a moment: pure, on the page's data. */
export const MOMENT = `
const LOG_WINDOW_MS = 500;
const MAX_LINES = 8;
const inSpan = (m, t) => m.at <= t && t <= m.at + (m.ms ?? 0);
function moment(T, t) {
  const covering = (row) => row.marks.filter((m) => inSpan(m, t));
  const last = (row) => row.marks.findLast((m) => m.at <= t);
  const frame = T.frames.marks.find((m) => inSpan(m, t)) ?? last(T.frames);
  // a moment on a slow frame is all of that frame: what explains it is often written as it ends
  const [from, to] = frame && inSpan(frame, t) ? [frame.at, frame.at + frame.ms] : [t, t];
  const away = (at) => Math.max(from - at, at - to, 0);
  const near = T.logs.marks
    .filter((l) => away(l.at) <= LOG_WINDOW_MS)
    .sort((a, b) => away(a.at) - away(b.at) || a.at - b.at);
  return {
    frame,
    stall: covering(T.stalls)[0],
    step: covering(T.steps)[0] ?? last(T.steps),
    requests: T.network.marks.filter((r) => r.ms === undefined ? away(r.at) <= LOG_WINDOW_MS : r.at <= to && from <= r.at + r.ms),
    logs: near.slice(0, MAX_LINES),
    logsMore: Math.max(0, near.length - MAX_LINES),
    memory: last(T.memory),
    traffic: last(T.traffic),
  };
}
`;

const PAGE = `
const T = JSON.parse(document.getElementById('timeline').textContent);
const $ = (id) => document.getElementById(id);
const video = document.querySelector('video');
const carried = $('video-bytes');
if (video && carried) {
  const text = atob(carried.textContent);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
  carried.remove();
}
const seconds = (ms) => (ms / 1000).toFixed(3) + ' s';
const line = (text, cls) => {
  const li = document.createElement('li');
  li.textContent = text;
  if (cls) li.className = cls;
  return li;
};
function say(list, lines) {
  $(list).replaceChildren(...(lines.length ? lines : [line('nothing here', 'none')]));
}
function show(t) {
  const at = Math.min(T.to, Math.max(T.from, t));
  const now = moment(T, at);
  $('cursor').style.left = ((at - T.from) / (T.to - T.from)) * 100 + '%';
  $('scrub').value = at - T.from;
  $('now').textContent = '+' + seconds(at - T.from);
  if (video && T.video) video.currentTime = Math.max(0, (at - T.video.firstAt) / 1000);
  say('now-screen', [
    ...(now.frame ? [line('frame: ' + now.frame.ms + ' ms' + (now.frame.late ? ', late' : ''), now.frame.late ? 'late' : '')] : []),
    ...(now.stall ? [line('main thread stopped for ' + Math.round(now.stall.ms) + ' ms', 'late')] : []),
    ...(now.step ? [line('step: ' + now.step.name)] : []),
    ...(now.memory ? [line('memory: ' + now.memory.mb + ' MB')] : []),
    ...(now.traffic ? [line('network: ' + now.traffic.inKbps + ' kbit/s in, ' + now.traffic.outKbps + ' out')] : []),
  ]);
  say('now-requests', now.requests.map((r) => line(r.name + (r.status ? ' ' + r.status : '') + (r.ms === undefined ? '' : ', ' + r.ms + ' ms'), r.failed ? 'late' : '')));
  say('now-logs', [...now.logs.map((l) => line(l.text, l.level)), ...(now.logsMore ? [line(now.logsMore + ' more within half a second', 'none')] : [])]);
}
document.addEventListener('click', (e) => {
  const moved = e.target.closest('[data-t]');
  if (moved) return show(Number(moved.dataset.t));
  const plots = e.target.closest('#plots');
  if (!plots) return undefined;
  const box = plots.getBoundingClientRect();
  return show(T.from + ((e.clientX - box.left) / box.width) * (T.to - T.from));
});
$('scrub').addEventListener('input', (e) => show(T.from + Number(e.target.value)));
show(Number($('scrub').dataset.first));
`;

export const SCRIPT = `(() => {${MOMENT}${PAGE}})();`;
