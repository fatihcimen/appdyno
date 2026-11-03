import { describe, expect, it } from 'vitest';
import { modelledEnergy } from '../src/energy-model.js';

describe('the energy model', () => {
  it('is one formula, says it is one, and adds up', () => {
    const e = modelledEnergy(2_000, 5_000_000);
    expect(e).toMatchObject({
      mj: 3_000,
      modelled: true,
      breakdown: { cpu: 2_000, network: 1_000 },
    });
    expect(e.note).toMatch(/A model, not a reading/);
  });

  it('reads a busy core clearly above an idle app', () => {
    expect(modelledEnergy(3_000, 0).mj).toBeGreaterThan(modelledEnergy(30, 0).mj! * 10);
  });
});
