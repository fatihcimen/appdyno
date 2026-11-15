import {
  DirectionalLight,
  OrthographicCamera,
  PMREMGenerator,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Body } from './body.ts';
import { COUGH, Fire, PUFF, type Breath } from './fire.ts';
import { Flames } from './flames.ts';
import { Mind, type Perch, type Point, type Traits } from './mind.ts';
import { CONTENT, blocks, onPage, perchOf, scout } from './perches.ts';
import { Rig } from './rig.ts';
import { GAUGE, HOP } from './signals.ts';

/** What `Mascot.astro` and the hero leave in the page for the scene. */
export interface Parts {
  /** What holds the canvas and the button: a small box on the page that goes with the dragon. */
  layer: HTMLElement;
  view: HTMLCanvasElement;
  /** The button that rides on the dragon: a tap or a key on it is a tap on the dragon. */
  body: HTMLButtonElement;
  /** The still picture the scene stands in for, on the top edge of the block the dragon starts on. */
  still: HTMLElement;
}

/** The dragon leans its top toward the eye, as seen from a little above. */
const LEAN = 0.2;
/** How far from side-on the dragon turns to the eye when it stands, and when it goes somewhere. */
const STANDING = 0.6;
const GOING = 0.3;
/** Seconds asleep before the frames stop: the fade into the sleep clip is done by then. */
const SETTLED = 2;
/** Depths in the scene: the dragon, and the fire in front of it. */
const DRAGON_Z = 300;
const FIRE_Z = 600;
/** The canvas is a square of this many body heights, the dragon's feet this share of the way down it. */
const BOX = 3.75;
const FEET = 0.72;
/** The page has come to rest when it has not scrolled for this long, in milliseconds. */
const AT_REST = 900;
/** A tap or a pointer this many body heights from it is near it. */
const NEAR = 5;
/** Under this height, as on a phone, it takes this share of its flights. */
const SMALL = 96;
const SMALL_FLIGHTS = 0.4;

/** Whether a frame is to be drawn: none with the tab hidden, once it sleeps, or out of view and not on its way. */
export const awake = (it: { hidden: boolean; asleep: number; inView: boolean; flying: boolean }) =>
  !it.hidden && it.asleep < SETTLED && (it.inView || it.flying);

const now = () => performance.now() / 1000;

/**
 * Opens the scene: the dragon in a canvas of its own, a small box that goes with it over the page,
 * in a world whose units are the page's pixels, so a place on the page is a place in the scene.
 * Rejects when there is no WebGL or the model does not load; the picture stays then.
 */
export async function open(parts: Parts): Promise<{ close: () => void }> {
  const { layer, view, body: rider, still } = parts;
  const renderer = new WebGLRenderer({ canvas: view, alpha: true, antialias: true });
  const ratio = Math.min(2, devicePixelRatio || 1);
  renderer.setPixelRatio(ratio);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const dyno = await loader.loadAsync(view.dataset['dyno'] ?? '').catch((failed: unknown) => {
    renderer.dispose();
    throw failed;
  });

  const scene = new Scene();
  const room = new PMREMGenerator(renderer);
  scene.environment = room.fromScene(new RoomEnvironment(), 0.04).texture;
  room.dispose();
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(-0.4, 1, 0.8);
  scene.add(sun);
  const camera = new OrthographicCamera();
  camera.position.z = 1000;
  camera.far = 2000;

  const rig = new Rig(dyno);
  const strides = { walk: rig.stride('walk'), run: rig.stride('run') };
  const fire = new Fire();
  const flames = new Flames(FIRE_Z);
  scene.add(rig.holder, flames.points);

  const onScreen = ({ y }: Point, size: number) => y - size > scrollY && y < scrollY + innerHeight;

  let pointer: Point | undefined;
  const traits: Traits = {
    lengths: rig.lengths,
    size: 0,
    walk: 0,
    run: 0,
    reach: 0,
    scout: () => scout(traits.size, pointer),
  };
  /** Its height as the page's styles have it now, and what goes by it. */
  const measure = () => {
    const size = parseFloat(getComputedStyle(layer).getPropertyValue('--mascot')) || SMALL;
    Object.assign(traits, {
      size,
      walk: strides.walk * size,
      run: strides.run * size,
      reach: size * 0.75,
      flights: size < SMALL ? SMALL_FLIGHTS : 1,
    });
  };
  measure();

  // it starts where its picture stands: on the top edge of the picture's block
  const block = still.closest('[data-perch]') ?? still;
  const edge = onPage(block);
  const first: Perch = {
    left: edge.left + traits.size / 2,
    right: edge.left + edge.width - traits.size / 2,
    y: edge.top,
  };
  blocks.set(first, { block, left: edge.left });
  const mind = new Mind(first, traits);
  const picture = onPage(still);
  mind.x = Math.min(first.right, Math.max(first.left, picture.left + picture.width / 2));
  const flesh = new Body();
  let side = NaN;

  /** Fits the scene to the page as it is laid out now: the dragon on its block, and the canvas around the dragon. */
  const fit = () => {
    const held = blocks.get(mind.perch);
    if (held && !flying()) {
      // a layout that moved its block has moved its perch
      const at = onPage(held.block);
      const dx = at.left - held.left;
      const dy = at.top - mind.perch.y;
      // less than a pixel is how a scrolled page rounds, not a move
      if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
        held.left = at.left;
        mind.ride(dx, dy);
      }
    }
    const { x, y } = mind.place;
    if (side !== BOX * traits.size) {
      side = BOX * traits.size;
      renderer.setSize(side, side, false);
    }
    const page = document.documentElement;
    // inside the page, so the box never makes the page wider or longer
    const left = Math.max(0, Math.min(page.clientWidth - side, x - side / 2));
    const top = Math.max(0, Math.min(page.scrollHeight - side, y - side * FEET));
    layer.style.transform = `translate(${left}px, ${top}px)`;
    camera.left = left;
    camera.right = left + side;
    camera.top = -top;
    camera.bottom = -(top + side);
    camera.updateProjectionMatrix();
    return { left, top };
  };

  // what the visitor does: where the pointer is, taps, scrolling, and the console's numbers
  const heard = new AbortController();
  const listen = { signal: heard.signal, passive: true };
  const fine = matchMedia('(pointer: fine)');
  let gaze: { at: Vector3; until: number } | undefined;
  const lookAt = (point: Point, seconds: number) => {
    const depth = DRAGON_Z + traits.size * 1.5;
    gaze = { at: new Vector3(point.x, -point.y, depth), until: now() + seconds };
  };
  addEventListener(
    'pointermove',
    (event) => {
      if (!fine.matches) return;
      pointer = { x: event.pageX, y: event.pageY };
      const { x, y } = mind.place;
      // a pointer on its own face would have it look every way at once
      if (Math.hypot(pointer.x - x, pointer.y - (y - traits.size * 0.7)) > traits.size * 0.5)
        lookAt(pointer, 6);
      if (mind.mode !== 'sleep' || near(pointer)) rouse();
    },
    listen,
  );
  rider.addEventListener('click', () => (mind.tap(now()), rouse()), listen);
  // a tap near it, on nothing a visitor reads or presses, gets a breath toward the tap
  document.addEventListener(
    'click',
    (event) => {
      const aim = { x: event.pageX, y: event.pageY };
      if ((event.target as Element).closest(CONTENT) || !near(aim)) return;
      lookAt(aim, 4);
      mind.tap(now(), aim);
      rouse();
    },
    listen,
  );
  document.addEventListener(
    GAUGE,
    (event) => {
      const number = document.getElementById(`v-${(event as CustomEvent<string>).detail}`);
      if (!number) return;
      const at = onPage(number);
      const aim = { x: at.left + at.width / 2, y: at.top + at.height / 2 };
      // the top edge of the dials' own block, or else the perch in view that is nearest the number
      const own = number.closest('[data-perch]');
      const by =
        (own && perchOf(own, traits.size)) ??
        traits
          .scout?.()
          .map((perch) => ({ perch, far: Math.abs(perch.y - aim.y) }))
          .sort((a, b) => a.far - b.far)[0]?.perch;
      lookAt(aim, 4);
      mind.gauge(now(), aim, by);
      rouse();
    },
    listen,
  );
  addEventListener('resize', measure, listen);
  document.addEventListener(HOP, () => (mind.cheer(now()), rouse()), listen);
  // out of sight once the page has come to rest: it comes in over the edge it was left behind
  const comeIn = () => {
    const { x, y } = mind.place;
    const size = traits.size;
    if (document.hidden || onScreen({ x, y }, size)) return;
    const above = y < scrollY + innerHeight / 2;
    mind.follow(now(), {
      x: Math.max(scrollX + size, Math.min(scrollX + innerWidth - size, x)),
      y: above ? scrollY - size * 0.5 : scrollY + innerHeight + size * 1.5,
    });
    rouse();
  };
  // a page opened part of the way down has it come in too
  let rest = setTimeout(comeIn, AT_REST);
  addEventListener(
    'scroll',
    () => {
      clearTimeout(rest);
      rest = setTimeout(comeIn, AT_REST);
    },
    listen,
  );

  // the frames: none while the dragon is out of view and not on its way, the tab is hidden, or it sleeps
  let inView = true;
  let frame = 0;
  let last = 0;
  let asleep = 0;
  let yaw = -Math.PI / 2 + STANDING;
  let breath: { is: Breath; from: number; until: number } | undefined;
  let later: [at: number, deed: () => void][] = [];
  function flying() {
    return mind.mode === 'fly' || mind.mode === 'hop';
  }
  function near(point: Point) {
    const { x, y } = mind.place;
    return Math.hypot(point.x - x, point.y - y) < NEAR * traits.size;
  }
  const drawn = () => awake({ hidden: document.hidden, asleep, inView, flying: flying() });
  function rouse() {
    mind.rouse(now());
    asleep = 0;
    if (drawn() && !frame) {
      last = 0;
      frame = requestAnimationFrame(draw);
    }
  }
  const watcher = new IntersectionObserver((seen) => {
    inView = seen.at(-1)?.isIntersecting ?? true;
    if (inView) rouse();
  });
  watcher.observe(layer);
  document.addEventListener('visibilitychange', () => !document.hidden && rouse(), listen);

  function draw(ms: number) {
    const time = ms / 1000;
    // a long gap between frames is cut, so nothing falls through the floor
    const dt = last ? Math.min(1 / 30, Math.max(0, time - last)) : 0;
    last = time;

    mind.step(dt, time);
    for (const deed of mind.deeds.splice(0)) {
      if ('clip' in deed) rig.shot(deed.clip);
      else if ('hop' in deed) flesh.hop(deed.hop);
      else if ('thud' in deed) flesh.jolt(-deed.thud * 1.6);
      else {
        rig.shot('puff');
        const smoke = deed.puff === 'smoke';
        const { fire: from, until } = rig.burns;
        breath = {
          is: smoke ? COUGH : PUFF,
          from: time + from,
          until: time + (smoke ? from + (until - from) / 2 : until),
        };
        if (deed.aim) lookAt(deed.aim, rig.lengths.puff);
        // the breath kicks; a breath with no fire in it ends in two coughs
        later.push([breath.from, () => flesh.jolt(0.9)]);
        if (smoke)
          for (const wait of [0.3, 0.65]) later.push([breath.from + wait, () => flesh.jolt(-1.6)]);
      }
    }
    later = later.filter(([at, deed]) => at > time || (deed(), false));
    flesh.step(dt);
    asleep = mind.mode === 'sleep' ? asleep + dt : 0;
    const box = fit();

    // the dragon: where its mind has it, as tall as its squash leaves it, turned the way it faces
    const size = traits.size;
    const place = mind.place;
    const going = flying() || mind.mode === 'walk' || mind.mode === 'run';
    const toward = -Math.PI / 2 + mind.facing * (Math.PI / 2 - (going ? GOING : STANDING));
    const turned = (toward - yaw) * Math.min(1, 9 * dt);
    yaw += turned;
    const wide = size / Math.sqrt(flesh.squash);
    rig.holder.position.set(place.x, -place.y + flesh.y * size, DRAGON_Z);
    rig.holder.scale.set(wide, size * flesh.squash, wide);
    rig.holder.rotation.set(LEAN, yaw, 0);
    rig.base(mind.base);
    if (gaze && time > gaze.until) gaze = undefined;
    const sees = mind.mode === 'sleep' || flying() ? undefined : gaze?.at;
    rig.update(dt, sees, dt ? turned / dt : 0);

    // the fire leaves the mouth where the frame's pose has put it
    if (breath && time >= breath.from) {
      const { at, out } = rig.mouth();
      const flat = Math.hypot(out.x, out.y);
      fire.emit(
        // a breath toward the eye is seen end-on: it does not reach far across the page
        { ...breath.is, speed: breath.is.speed * Math.max(0.4, flat) },
        { x: at.x, y: -at.y, angle: Math.atan2(-out.y, out.x) },
        size,
        dt,
        flesh.vy,
      );
      if (time > breath.until) breath = undefined;
    }
    fire.step(dt);
    flames.show(fire, ratio);
    rig.glow(fire.glow);

    rider.style.transform = `translate(${place.x - box.left}px, ${place.y - box.top}px)`;
    renderer.render(scene, camera);
    frame = drawn() ? requestAnimationFrame(draw) : 0;
  }

  // the first frame is drawn before the picture gives way to it
  draw(performance.now());
  const root = document.documentElement;
  root.classList.add('mascot-live');
  rider.hidden = false;

  return {
    close() {
      cancelAnimationFrame(frame);
      clearTimeout(rest);
      heard.abort();
      watcher.disconnect();
      root.classList.remove('mascot-live');
      rider.hidden = true;
      scene.environment?.dispose();
      renderer.dispose();
    },
  };
}
