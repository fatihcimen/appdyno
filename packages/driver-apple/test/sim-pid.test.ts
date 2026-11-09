import { describe, expect, it } from 'vitest';
import { pidOfApp } from '../src/simctl.js';

const DEVICES = '/Users/me/Library/Developer/CoreSimulator/Devices';
const APP = `${DEVICES}/2B7BFC1C-8A4D-462B-972D-2988FF298A1F/data/Containers/Bundle/Application/A567B9EF-1E4B-4D3A-9F1A-B2E6E018FE45/My App.app`;
const OTHER = `${DEVICES}/FAC55233-3F44-498D-A3A6-9EE0DE3EAFFF/data/Containers/Bundle/Application/0C1D2E3F-1E4B-4D3A-9F1A-B2E6E018FE45/My App.app`;

describe("a simulator app's process in the Mac's list", () => {
  it('is the executable right in its folder, not an extension of it nor the same app on another simulator', () => {
    const ps = [
      '    1 /sbin/launchd',
      `  412 ${OTHER}/My App`,
      `  513 ${APP}/PlugIns/My Widget.appex/My Widget`,
      `80898 ${APP}/My App -NSDoubleLocalizedStrings YES`,
      '',
    ].join('\n');
    expect(pidOfApp(ps, APP)).toBe(80898);
  });

  it('is none when only an extension of the app runs', () => {
    expect(pidOfApp(`  513 ${APP}/PlugIns/W.appex/W\n`, APP)).toBeUndefined();
    expect(pidOfApp('', APP)).toBeUndefined();
  });
});
