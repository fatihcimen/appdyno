#!/usr/bin/env node
/**
 * Regenerates every icon, logo and mark from scripts/icon-art.mjs, and compiles the Icon Composer file
 * to prove it. The app's icons and menu glyph are built with the app; see scripts/build-app.mjs.
 *
 *   node scripts/build-icons.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATED, iosIcon, macIcon, menuGlyph, social } from './icon-art.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const sh = (command, ...args) => execFileSync(command, args, { stdio: 'pipe', encoding: 'utf8' });

/** Through the same tool at every size: it draws an SVG at the size the file declares. */
function render(svg, out) {
  const made = mkdtempSync(join(tmpdir(), 'appdyno-icon-'));
  const source = join(made, 'art.svg');
  writeFileSync(source, svg);
  mkdirSync(dirname(out), { recursive: true });
  sh('sips', '-s', 'format', 'png', source, '--out', out);
  rmSync(made, { recursive: true, force: true });
}

/**
 * The Mac's sizes, each drawn for itself. macOS 27 sets the two 1x sizes below 64 px on a grey plate,
 * on a 1x display only. Left out, it scales the large drawing down there, which is worse: a letter.
 */
const ICONSET = [
  ['16x16', 16],
  ['16x16@2x', 32],
  ['32x32', 32],
  ['32x32@2x', 64],
  ['128x128', 128],
  ['128x128@2x', 256],
  ['256x256', 256],
  ['256x256@2x', 512],
  ['512x512', 512],
  ['512x512@2x', 1024],
];

/** The app's icon, through iconutil. */
export function buildIcns(out) {
  const made = mkdtempSync(join(tmpdir(), 'appdyno-iconset-'));
  const set = join(made, 'appdyno.iconset');
  mkdirSync(set);
  for (const [name, px] of ICONSET) render(macIcon(px), join(set, `icon_${name}.png`));
  sh('iconutil', '-c', 'icns', set, '-o', out);
  rmSync(made, { recursive: true, force: true });
}

/** The menu bar's template image at 18 pt; the name is what makes AppKit take it as a template. */
export function buildMenuGlyph(dir) {
  render(menuGlyph(18), join(dir, 'menuTemplate.png'));
  render(menuGlyph(36), join(dir, 'menuTemplate@2x.png'));
}

/**
 * The glass icon for macOS 26 and later, compiled by the tool Xcode uses into an Assets.car. actool writes an
 * .icns beside it, scaled from the large drawing: `buildIcns` after it puts the drawn one in its place.
 */
export function buildGlassIcon(dir, minimum) {
  const made = mkdtempSync(join(tmpdir(), 'appdyno-glass-'));
  const said = sh(
    'xcrun',
    'actool',
    join(repo, 'mac/App/appdyno.icon'),
    '--compile',
    dir,
    '--app-icon',
    'appdyno',
    '--platform',
    'macosx',
    '--minimum-deployment-target',
    minimum,
    '--output-partial-info-plist',
    join(made, 'partial.plist'),
    '--errors',
    '--warnings',
  );
  rmSync(made, { recursive: true, force: true });
  if (!existsSync(join(dir, 'Assets.car')) || /error:|warning:/i.test(said))
    throw new Error(`actool refused the icon: ${said}`);
}

function main() {
  for (const [path, text] of Object.entries(GENERATED)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  render(iosIcon(120), join(repo, 'ios/Branding/AppIcon60x60@2x.png'));
  render(iosIcon(180), join(repo, 'ios/Branding/AppIcon60x60@3x.png'));
  render(macIcon(256), join(repo, 'mac/Viewer/tile.png'));
  render(social(), join(repo, 'docs/images/social.png'));
  const proof = mkdtempSync(join(tmpdir(), 'appdyno-proof-'));
  buildGlassIcon(proof, '14.0');
  rmSync(proof, { recursive: true, force: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
