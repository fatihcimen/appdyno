import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { frameworkOfViews, viewLines, type ViewTree } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import type { Adb } from '../src/adb.js';
import { AndroidDevice } from '../src/device.js';
import { androidViews, focusOf, VIEWS_READ, viewsOf } from '../src/views.js';
import { NOT_ANSWERING } from '../src/window-dump.js';

/**
 * fixtures/views/*.txt are what VIEWS_READ printed on our own emulators, Google APIs arm64 images of API 35 and 36, with
 * only the lines it reads kept: the fixture's screens, its release built with R8 (minified-*), then open-source apps'
 * debug builds, each named by its screen.
 */
const recorded = (name: string) =>
  readFileSync(join(import.meta.dirname, 'fixtures/views', `${name}.txt`), 'utf8');
const MARK = '\n@@ activity\n';
const halves = (text: string) => {
  const [windows = '', dump = ''] = text.split(MARK);
  return { windows, dump };
};
const treeOf = (text: string) => {
  const { windows, dump } = halves(text);
  const focus = focusOf(windows);
  if (!focus) throw new Error('no focus');
  const tree = viewsOf(dump, focus);
  if (!tree) throw new Error('no block of the focused record');
  return tree;
};
const tree = (name: string) => treeOf(recorded(name));
const byId = (t: ViewTree, name: string) => t.views.find((v) => v.id?.endsWith(`:id/${name}`));

/** The read run by this Mac's shell, its dumpsys answering with `text`'s halves: what it printed, and what it asked. */
function runRead(text: string) {
  const { windows, dump } = halves(text);
  const r = spawnSync(
    'sh',
    [
      '-c',
      `dumpsys() { if [ "$1" = window ]; then printf '%s\\n' "$W"; else echo "$*" >&2; printf '%s' "$D"; fi; }; ${VIEWS_READ}`,
    ],
    { encoding: 'utf8', env: { ...process.env, W: windows, D: dump } },
  );
  return { out: r.stdout, asked: r.stderr.trim() };
}

describe('the read of the native views', () => {
  it("dumps the activity with the focus on the phone's own display, by its component", () => {
    const { out, asked } = runRead(recorded('form-36'));
    expect(asked).toBe('activity dev.appdyno.fixture/.FormActivity');
    expect(out).toBe(recorded('form-36'));
    // a mirror's display comes first, with an app of its own in front
    const mirrored = recorded('form-36').replace(
      '  Display: mDisplayId=0',
      '  Display: mDisplayId=2\n  mFocusedApp=ActivityRecord{a1b2c3 u0 dev.other/.Main t40}\n  Display: mDisplayId=0',
    );
    expect(runRead(mirrored).asked).toBe('activity dev.appdyno.fixture/.FormActivity');
    expect(focusOf(halves(mirrored).windows)?.component).toBe('dev.appdyno.fixture/.FormActivity');
  });

  it('asks nothing more where no activity has the focus', () => {
    const none = recorded('form-36').replace(/mFocusedApp=.*/, 'mFocusedApp=null');
    const { out, asked } = runRead(none);
    expect(asked).toBe('');
    expect(out).not.toContain(MARK);
  });

  it('labels each recorded screen by the framework that draws it', () => {
    const cases: [string, string][] = [
      ['compose-35', 'Compose'],
      ['compose-36', 'Compose'],
      ['web-35', 'web view'],
      ['web-36', 'web view'],
      ['form-35', 'Android views'],
      ['form-36', 'Android views'],
      ['list-scrolled-36', 'Android views'],
      ['nowinandroid-36', 'Compose'],
      ['antennapod-35', 'Android views'],
      ['wikipedia-article-36', 'web view'],
      ['wikipedia-feed-36', 'Compose'],
      ['wonderous-36', 'Flutter'],
      ['newpipe-pager-36', 'Android views'],
    ];
    const labels = cases.map(([name]) => [name, frameworkOfViews(tree(name), 'android')?.name]);
    expect(labels).toEqual(cases);
  });

  it('adds each place up through its parents, in pixels, with its id, flags and the activity at the root', () => {
    for (const api of ['35', '36']) {
      const t = tree(`form-${api}`);
      expect(t.views[0]).toMatchObject({
        class: 'com.android.internal.policy.DecorView',
        controller: 'dev.appdyno.fixture.FormActivity',
        rect: { x: 0, y: 0, width: 1080, height: 2400 },
      });
      expect(t.views[0]?.parent).toBeUndefined();
      expect(byId(t, 'submit')).toMatchObject({
        class: 'android.widget.Button',
        id: 'dev.appdyno.fixture:id/submit',
        rect: { x: 32, y: 922, width: 1016, height: 126 },
        flags: ['clickable'],
      });
      // inside a layout of its own at 32,395
      expect(byId(t, 'gsm_input')?.rect).toEqual({ x: 32, y: 446, width: 1016, height: 118 });
      expect(byId(t, 'action_mode_bar_stub')).toMatchObject({ hidden: true, flags: ['gone'] });
      expect(t.views.find((v) => v.id === 'android:id/content')).toBeDefined();
    }
  });

  it('reads a place above its parent, a selected tab, and a class with $ in it', () => {
    const pod = tree('antennapod-35');
    const ring = pod.views.find((v) => v.class.endsWith('.CircleImageView'));
    const pull = byId(pod, 'swipeRefresh');
    expect(ring?.rect).toEqual({ x: 488, y: (pull?.rect.y ?? 0) - 105, width: 104, height: 105 });
    const tabs = tree('newpipe-pager-36').views.filter((v) =>
      v.class.endsWith('TabLayout$TabView'),
    );
    expect(tabs.map((v) => v.flags)).toEqual([
      ['clickable'],
      ['clickable', 'selected'],
      ['clickable'],
      ['clickable'],
    ]);
  });

  it('says where a container that scrolls holds more than it shows, its outermost alone', () => {
    expect(tree('showcase-scrolled-36').notes).toEqual([
      "under android.widget.ScrollView at 0,0 1080x2400, places are its layout's: its scroll moves them on the screen",
    ]);
    expect(tree('newpipe-pager-36').notes).toEqual([
      "under androidx.viewpager.widget.ViewPager #pager at 0,409 1080x1928, places are its layout's: its scroll moves them on the screen",
    ]);
    // a list moves its rows themselves, and a form that fits its scroll view cannot scroll
    expect(tree('list-scrolled-36').notes).toEqual([]);
    expect(tree('form-36').notes).toEqual([]);
  });

  it("starts from the activity's window, and says what windows over it are not here", () => {
    const t = tree('dialog-36');
    expect(t.notes).toEqual([
      'a window over the activity, as a dialog or a menu, is not in these views: screen reads it',
    ]);
    expect(byId(t, 'open_dialog')?.rect).toEqual({ x: 32, y: 96, width: 1016, height: 126 });
    const moved = recorded('form-36').replace(
      'frame=[0,0][1080,2400] last',
      'frame=[100,300][1080,2400] last',
    );
    expect(byId(treeOf(moved), 'submit')?.rect).toMatchObject({ x: 132, y: 1222 });
    // another app's activity listed above, as in split screen
    const beside = recorded('form-36').replace(
      '  Window #0',
      '  Window #0 Window{c0ffee u0 dev.other/dev.other.Main}:\n    mDisplayId=0\n    mAttrs={(0,0)(fillxfill) ty=BASE_APPLICATION\n    Frames: parent=[0,0][1080,1200] frame=[0,0][1080,1200] last=[0,0][1080,1200]\n  Window #1',
    );
    expect(treeOf(beside).notes).toEqual([]);
    const gone = recorded('form-36').replace('ty=BASE_APPLICATION', 'ty=APPLICATION_STARTING');
    expect(treeOf(gone).notes).toEqual([
      "the activity's window is not on the screen: these places are where it was last laid out",
    ]);
  });

  it('takes the focused record from several blocks of one component, in hex or in decimal', () => {
    const { windows, dump } = halves(recorded('form-36'));
    const block = dump.slice(dump.indexOf('  ACTIVITY'));
    // the other's views moved, as another instance's of the same screen are elsewhere
    const other = block
      .replace('FormActivity f91b0ff', 'FormActivity 1912070')
      .replace('32,922-1048,1048', '32,10-1048,136');
    const two = `${other}\n${block}`;
    const focus = focusOf(windows);
    // f91b0ff written in decimal, as API 36 writes a record
    expect(focus?.record).toBe('261206271');
    if (!focus) return;
    expect(byId(viewsOf(two, focus) ?? tree('form-36'), 'submit')?.rect.y).toBe(922);
    const hex = viewsOf(`${block}\n${other}`, { ...focus, record: '1912070' });
    expect(byId(hex ?? tree('form-36'), 'submit')?.rect.y).toBe(10);
    expect(viewsOf('Bad activity command, or no activities match: x', focus)).toBeUndefined();
  });

  it("says where a minified build's shrinker named what draws the screen, as it named Compose's views", () => {
    // the fixture built with R8, its Compose start screen opened twice: the focused one is the second
    const t = tree('minified-compose-36');
    expect(t.views.map((v) => v.class).slice(4, 6)).toEqual(['pi', 'p3']);
    expect(t.views[0]?.hidden).toBeUndefined();
    expect(frameworkOfViews(t, 'android')).toEqual({ name: 'Android views' });
    expect(t.notes).toEqual([
      "pi, p3: named by the build's shrinker, so no name tells what draws there; Compose reads as Android views in such a build",
    ]);
    expect(tree('compose-36').notes).toEqual([]);
    // as another build's shrinker names one, of mixed case
    const mixed = treeOf(recorded('minified-compose-36').replaceAll(' pi{', ' dH0{'));
    expect(mixed.notes?.[0]).toMatch(/^dH0, p3: named by the build's shrinker/);
  });

  it('keeps a line of its own making in the tree, at its parent place', () => {
    const odd = recorded('compose-36').replace(
      /( +)androidx\.compose\.ui\.platform\.ComposeView/,
      '$1com.example.Odd says hello\n$1  androidx.compose.ui.platform.ComposeView',
    );
    const t = treeOf(odd);
    const at = t.views.findIndex((v) => v.class === 'com.example.Odd');
    expect(t.views[at]?.rect).toEqual(t.views[t.views[at]?.parent ?? -1]?.rect);
    expect(t.views.find((v) => v.class.endsWith('.ComposeView'))?.parent).toBe(at);
    expect(frameworkOfViews(t, 'android')?.name).toBe('Compose');
  });

  it('folds into lines, with ids by their names and flags after the place', () => {
    expect(viewLines(tree('form-36'), (s) => s).slice(0, 4)).toEqual([
      'com.android.internal.policy.DecorView (dev.appdyno.fixture.FormActivity) > android.widget.LinearLayout > android.widget.FrameLayout #content 0,0 1080x2400',
      ' android.widget.ScrollView > android.widget.LinearLayout 0,0 1080x1131',
      '  android.widget.TextView 32,96 1016x63',
      '  android.widget.EditText #name_input 32,159 1016x118 clickable',
    ]);
  });

  it('refuses a hung app by what the system said', () => {
    const { windows, dump } = halves(recorded('hung-36'));
    const focus = focusOf(windows);
    expect(focus).toBeDefined();
    if (!focus) return;
    expect(() => viewsOf(dump, focus)).toThrow(
      new DeviceError(
        'TIMEOUT',
        'dev.appdyno.fixture/.MainActivity did not give its views: it is not answering',
        NOT_ANSWERING,
      ),
    );
  });
});

describe('the views of the activity in front', () => {
  const answering =
    (...outs: (string | Error)[]) =>
    () => {
      const out = outs.shift() ?? '';
      return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
    };

  it('reads once more where the focus moved on the way, then says so', async () => {
    const { windows } = halves(recorded('form-36'));
    const moved = `${windows}${MARK}Bad activity command, or no activities match: x\n`;
    const t = await androidViews(answering(moved, recorded('form-36')));
    expect(byId(t, 'submit')).toBeDefined();
    await expect(androidViews(answering(moved, moved))).rejects.toThrow(
      'dev.appdyno.fixture/.FormActivity went while its views were read',
    );
  });

  it('says that no activity has the focus, or that dumpsys did not answer', async () => {
    const none = halves(recorded('form-36')).windows.replace(/mFocusedApp=.*/, 'mFocusedApp=null');
    await expect(androidViews(answering(none))).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'no activity has the focus to read its views',
    });
    const slow = new DeviceError('TIMEOUT', 'adb command timed out: w=$(dumpsys window');
    await expect(androidViews(answering(slow))).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: 'dumpsys did not answer for the views in 15 s',
    });
  });

  it("are the device's, read through adb with no agent", async () => {
    const asked: [string, number | undefined][] = [];
    const exec = (_serial: string, command: string, o: { timeoutMs?: number } = {}) => {
      asked.push([command, o.timeoutMs]);
      return Promise.resolve(recorded('compose-36'));
    };
    const t = await new AndroidDevice('emulator-5554', { exec } as unknown as Adb).views();
    expect(asked).toEqual([[VIEWS_READ, 15_000]]);
    expect(frameworkOfViews(t, 'android')).toEqual({ name: 'Compose' });
  });
});
