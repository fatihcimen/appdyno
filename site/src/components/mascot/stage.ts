import {
  Box3,
  DirectionalLight,
  Group,
  OrthographicCamera,
  PMREMGenerator,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Body } from './body.ts';
import { COUGH, Fire, PUFF, type Breath } from './fire.ts';
import { Flames } from './flames.ts';
import { Mind, type Point, type Traits } from './mind.ts';
import { Rig } from './rig.ts';
import { GAUGE, HOP } from './signals.ts';

/** What `Mascot.astro` and the bench leave in the page for the scene. */
export interface Parts {
  bench: HTMLElement;
  stage: HTMLElement;
  view: HTMLCanvasElement;
  /** The button that rides on the dragon: a tap or a key on it is a tap on the dragon. */
  body: HTMLButtonElement;
  /** The still pictures the scene stands in for, each where its model goes. */
  posters: { dyno: HTMLElement; bench: HTMLElement };
}

/** The floor is this far above the stage's bottom edge, in pixels. */
const FLOOR = 8;
/** Both models lean their tops toward the eye, as seen from a little above. */
const LEAN = 0.2;
/** How far from side-on the dragon turns to the eye when it stands, and when it goes somewhere. */
const STANDING = 0.6;
const GOING = 0.3;
/** The bench as its picture shows it, and how far a screen's height of scroll turns it. */
const BENCH_TURN = -1.13;
const SCROLL_TURN = 0.5;
/** Seconds asleep before the frames stop: the fade into the sleep clip is done by then. */
const SETTLED = 2;
/** Depths in the scene: the bench, the dragon in front of it, the fire in front of both. */
const DRAGON_Z = 300;
const FIRE_Z = 600;

const now = () => performance.now() / 1000;

/**
 * Opens the scene on the bench: the dragon and the dynamometer in one canvas over the bench, in
 * a world whose units are the page's pixels, so a place on the page is a place in the scene.
 * Rejects when there is no WebGL or a model does not load; the posters stay then.
 */
export async function open(parts: Parts): Promise<{ close: () => void }> {
  const { bench, stage, view, body: rider, posters } = parts;
  const renderer = new WebGLRenderer({ canvas: view, alpha: true, antialias: true });
  const ratio = Math.min(2, devicePixelRatio || 1);
  renderer.setPixelRatio(ratio);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [dyno, dynamometer] = await Promise.all([
    loader.loadAsync(view.dataset['dyno'] ?? ''),
    loader.loadAsync(view.dataset['bench'] ?? ''),
  ]).catch((failed: unknown) => {
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

  // the dynamometer turns about its own middle
  const middle = new Box3().setFromObject(dynamometer.scene).getBoundingSphere(new Sphere());
  dynamometer.scene.position.sub(middle.center);
  const table = new Group().add(dynamometer.scene);
  table.rotation.order = 'XYZ';
  const rig = new Rig(dyno);
  rig.holder.rotation.order = 'XYZ';
  const strides = { walk: rig.stride('walk'), run: rig.stride('run') };
  const fire = new Fire();
  const flames = new Flames(FIRE_Z);
  scene.add(table, rig.holder, flames.points);

  const traits: Traits = { lengths: rig.lengths, walk: 0, run: 0, reach: 0 };
  const mind = new Mind({ left: 0, right: 1, y: 0 }, traits);
  const flesh = new Body();
  let size = 0;
  let box = { left: NaN, top: NaN, width: NaN, height: NaN };

  /** An element's box on the page, not on the screen. */
  const onPage = (element: Element) => {
    const { left, top, width, height } = element.getBoundingClientRect();
    return { left: left + scrollX, top: top + scrollY, width, height };
  };

  /** Fits the scene to the bench as the page has laid it out now. */
  const fit = () => {
    const at = onPage(bench);
    if (
      at.left === box.left &&
      at.top === box.top &&
      at.width === box.width &&
      at.height === box.height
    )
      return;
    const first = Number.isNaN(box.left);
    box = at;
    renderer.setSize(at.width, at.height, false);
    camera.left = at.left;
    camera.right = at.left + at.width;
    camera.top = -at.top;
    camera.bottom = -(at.top + at.height);
    camera.updateProjectionMatrix();
    size = parseFloat(getComputedStyle(bench).getPropertyValue('--mascot')) || 96;
    Object.assign(traits, {
      walk: strides.walk * size,
      run: strides.run * size,
      reach: size * 0.75,
    });
    const cell = onPage(posters.bench);
    table.scale.setScalar((0.62 * Math.min(cell.width, cell.height)) / middle.radius);
    table.position.set(cell.left + cell.width / 2, -(cell.top + cell.height / 2), 0);
    const floor = onPage(stage);
    mind.stand({
      left: floor.left + size / 2,
      right: floor.left + floor.width - size / 2,
      y: floor.top + floor.height - FLOOR,
    });
    if (first) {
      const picture = onPage(posters.dyno);
      mind.x = picture.left + picture.width / 2;
    }
  };

  // what the visitor does: where the pointer is, taps, and the console's numbers
  const heard = new AbortController();
  const listen = { signal: heard.signal, passive: true };
  const fine = matchMedia('(pointer: fine)');
  let gaze: { at: Vector3; until: number } | undefined;
  const lookAt = (point: Point, seconds: number) => {
    gaze = { at: new Vector3(point.x, -point.y, DRAGON_Z + size * 1.5), until: now() + seconds };
  };
  addEventListener(
    'pointermove',
    (event) => {
      if (!fine.matches) return;
      const point = { x: event.pageX, y: event.pageY };
      const head = { x: mind.x, y: mind.perch.y - size * 0.7 };
      // a pointer on its own face would have it look every way at once
      if (Math.hypot(point.x - head.x, point.y - head.y) > size * 0.5) lookAt(point, 6);
      if (mind.mode !== 'sleep' || bench.contains(event.target as Node)) rouse();
    },
    listen,
  );
  bench.addEventListener(
    'click',
    (event) => {
      const on = event.target as Element;
      if (on === rider) mind.tap(now());
      else if (!on.closest('button, a')) {
        const aim = { x: event.pageX, y: event.pageY };
        lookAt(aim, 4);
        mind.tap(now(), aim);
      }
      rouse();
    },
    listen,
  );
  document.addEventListener(
    GAUGE,
    (event) => {
      const dial = document.getElementById(`n-${(event as CustomEvent<string>).detail}`);
      if (!dial) return;
      const at = onPage(dial.closest('svg') ?? dial);
      const aim = { x: at.left + at.width / 2, y: at.top + at.height * 0.4 };
      lookAt(aim, 4);
      mind.gauge(now(), aim);
      rouse();
    },
    listen,
  );
  document.addEventListener(HOP, () => (mind.cheer(now()), rouse()), listen);

  // the frames: none while the bench is out of view, the tab is hidden, or the dragon sleeps
  let inView = true;
  let frame = 0;
  let last = 0;
  let asleep = 0;
  let yaw = -Math.PI / 2 + STANDING;
  let breath: { is: Breath; from: number; until: number } | undefined;
  let later: [at: number, deed: () => void][] = [];
  const awake = () => inView && !document.hidden && asleep < SETTLED;
  function rouse() {
    mind.rouse(now());
    asleep = 0;
    if (awake() && !frame) {
      last = 0;
      frame = requestAnimationFrame(draw);
    }
  }
  const watcher = new IntersectionObserver((seen) => {
    inView = seen.at(-1)?.isIntersecting ?? true;
    if (inView) rouse();
  });
  watcher.observe(bench);
  document.addEventListener('visibilitychange', () => !document.hidden && rouse(), listen);

  function draw(ms: number) {
    const time = ms / 1000;
    // a long gap between frames is cut, so nothing falls through the floor
    const dt = last ? Math.min(1 / 30, Math.max(0, time - last)) : 0;
    last = time;
    fit();

    mind.step(dt, time);
    for (const deed of mind.deeds.splice(0)) {
      if ('clip' in deed) rig.shot(deed.clip);
      else if ('hop' in deed) flesh.hop(deed.hop);
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

    // the dragon: on its perch, as tall as its squash leaves it, turned the way it faces
    const going = mind.mode === 'walk' || mind.mode === 'run';
    const toward = -Math.PI / 2 + mind.facing * (Math.PI / 2 - (going ? GOING : STANDING));
    const turned = (toward - yaw) * Math.min(1, 9 * dt);
    yaw += turned;
    const wide = size / Math.sqrt(flesh.squash);
    rig.holder.position.set(mind.x, -mind.perch.y + flesh.y * size, DRAGON_Z);
    rig.holder.scale.set(wide, size * flesh.squash, wide);
    rig.holder.rotation.set(LEAN, yaw, 0);
    rig.base(mind.base);
    if (gaze && time > gaze.until) gaze = undefined;
    rig.update(dt, mind.mode === 'sleep' ? undefined : gaze?.at, dt ? turned / dt : 0);

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

    table.rotation.set(LEAN, BENCH_TURN + (SCROLL_TURN * scrollY) / innerHeight, 0);
    rider.style.transform = `translate(${mind.x - box.left}px, ${mind.perch.y - box.top}px)`;
    renderer.render(scene, camera);
    frame = awake() ? requestAnimationFrame(draw) : 0;
  }

  // the first frame is drawn before the posters give way to it
  draw(performance.now());
  bench.classList.add('live');
  rider.hidden = false;

  return {
    close() {
      cancelAnimationFrame(frame);
      heard.abort();
      watcher.disconnect();
      bench.classList.remove('live');
      rider.hidden = true;
      scene.environment?.dispose();
      renderer.dispose();
    },
  };
}
