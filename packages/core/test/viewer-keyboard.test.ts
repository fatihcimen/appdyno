import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VIEWER } from './viewer-helpers.js';

describe('the keyboard', () => {
  const source = (f: string) => readFileSync(join(VIEWER, f), 'utf8');

  it('is taken in one place, and that one is what --focus asks for', () => {
    const window = source('Window.m');
    for (const taking of ['makeKeyAndOrderFront', 'activateIgnoringOtherApps']) {
      const all = readdirSync(VIEWER)
        .filter((f) => f.endsWith('.m'))
        .flatMap((f) =>
          source(f)
            .split('\n')
            .filter((l) => l.includes(taking)),
        );
      expect(all, taking).toHaveLength(1);
      expect(window.indexOf(taking)).toBeGreaterThan(window.indexOf('case MVShowFocused:'));
      expect(window.indexOf(taking)).toBeLessThan(window.indexOf('- (void)raise'));
    }
    expect(window).toContain('MVShowOf([attach[@"focus"] boolValue]');
    expect(source('Hub.m')).toContain('MVPresent(_window, how)');
  });

  it('a card over the picture takes no click, but on its own button', () => {
    expect(source('Overlay.m')).toMatch(
      /@implementation MVOverlayCard\n- \(NSView \*\)hitTest[^}]*isKindOfClass:NSButton\.class\] \? hit : nil;/,
    );
  });

  it('no launch brings the viewer forward', () => {
    expect(source('main.m')).toContain(
      'application.activationPolicy = NSApplicationActivationPolicyProhibited',
    );
    expect(source('main.m')).not.toContain(
      'application.activationPolicy = NSApplicationActivationPolicyRegular',
    );
  });

  it('nothing the viewer writes as a log holds what was typed', () => {
    for (const f of readdirSync(VIEWER).filter((n) => n.endsWith('.m'))) {
      expect(source(f), f).not.toMatch(/NSLog|fprintf\(stderr/);
    }
  });
});
