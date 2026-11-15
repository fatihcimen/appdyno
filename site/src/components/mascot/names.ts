/**
 * What the page finds in `public/models/dyno.glb` by name: the bones it turns and reads, and the
 * clips it plays. `scripts/compress-models.mjs` keeps these names and holds the file to them.
 */
export const BONES = [
  'Hip',
  'NeckTwist01',
  'Head',
  'Jaw',
  'FireSocket',
  'Tail01',
  'Tail02',
  'Tail03',
  'WingL01',
  'WingL02',
  'WingR01',
  'WingR02',
  'L_Foot',
] as const;
export type Bone = (typeof BONES)[number];

export const CLIPS = [
  'idle',
  'walk',
  'run',
  'look',
  'scratch',
  'sit',
  'sleep',
  'puff',
  'fly',
  'takeoff',
  'land',
] as const;
export type Clip = (typeof CLIPS)[number];
