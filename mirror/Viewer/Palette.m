// Every colour of the hub, by look, in one place. What stands behind the glass is a ground painted from these: the system's
// glass has no colour of its own, so a window is as rich as what it stands on, whatever a device shows.
#import "Style.h"
#import "Window.h"

enum { kHues = 6, kBlooms = 4 };
// Increase Contrast: lines stand this much stronger, marks this much nearer the ink, and the ground's glows this much fainter
static const double kStrongRule = 2.5, kStrongMark = 0.35, kStrongGlow = 0.5, kStrongEdge = 0.5;

typedef struct {
  /// From the window's top left, as shares of it, and how far it reaches as a share of the window's width.
  float x, y, reach, strength;
  uint32_t color;
} MVBloom;

typedef struct {
  uint32_t ink, quiet, accent, fillFrom, fillTo, rule;
  uint32_t good, watch, bad, agent;
  uint32_t ground, surface;
  /// A card's ground over the window's, and the light on its rim.
  uint32_t card, edge;
  float cardAlpha, edgeAlpha;
  /// A hue as a mark, and as the ground of a tile with a white symbol on it.
  uint32_t hues[kHues], tiles[kHues];
  MVBloom blooms[kBlooms];
} MVSide;

static const MVSide kDark = {
    .ink = 0xF4F6FF, .quiet = 0xD0D6F2, .accent = 0x7EA2FF, .fillFrom = 0x3F6BFF, .fillTo = 0x7A3DF0, .rule = 0xFFFFFF,
    .good = 0x3EE08F, .watch = 0xFFBE3D, .bad = 0xFF6B5E, .agent = 0xC29BFF,
    .ground = 0x0A0E2E, .surface = 0x1A2460, .card = 0xFFFFFF, .edge = 0xFFFFFF, .cardAlpha = 0.07, .edgeAlpha = 0.13,
    .hues = {0x7EA2FF, 0xB79CFF, 0xFF8AD8, 0x5FD0F7, 0x9FB2FF, 0xE0A6FF},
    .tiles = {0x3358F0, 0x7B3DEB, 0xC92AA0, 0x0E86C9, 0x4A55D8, 0x9A35D0},
    .blooms = {{0.98, 0.04, 0.34, 0.86, 0x1F3FD6}, {0.0, 1.0, 0.36, 0.86, 0x5B1FC4}, {0.94, 1.04, 0.24, 0.66, 0xB81C68}, {0.02, 0.0, 0.2, 0.5, 0x0B6DBD}},
};

static const MVSide kLight = {
    .ink = 0x12163A, .quiet = 0x434A78, .accent = 0x2447E0, .fillFrom = 0x2F52F0, .fillTo = 0x7A2EE0, .rule = 0x1A2050,
    .good = 0x0B7A3E, .watch = 0x9A5700, .bad = 0xC4201A, .agent = 0x6A32C8,
    .ground = 0xEEF0FF, .surface = 0xD9DFFF, .card = 0xFFFFFF, .edge = 0xFFFFFF, .cardAlpha = 0.62, .edgeAlpha = 0.8,
    .hues = {0x2447E0, 0x6A32C8, 0xA8189A, 0x0B6FA8, 0x3A4FC0, 0x7F2AC0},
    .tiles = {0x3358F0, 0x7B3DEB, 0xC92AA0, 0x0E86C9, 0x4A55D8, 0x9A35D0},
    .blooms = {{0.98, 0.04, 0.42, 1.0, 0xA6B8FF}, {0.0, 1.0, 0.44, 1.0, 0xD3AFFF}, {0.94, 1.04, 0.3, 0.92, 0xFFB3D1}, {0.02, 0.0, 0.26, 0.8, 0xA8DEFF}},
};

/// What stands out on the accent's own gradient, in either look.
static const uint32_t kHeroMark = 0xFF7FD0;

static NSColor *hex(uint32_t value, double alpha) {
  return [NSColor colorWithSRGBRed:(value >> 16 & 255) / 255.0 green:(value >> 8 & 255) / 255.0 blue:(value & 255) / 255.0 alpha:alpha];
}

BOOL MVIsDark(NSAppearance *look) {
  return [[look bestMatchFromAppearancesWithNames:@[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]] isEqual:NSAppearanceNameDarkAqua];
}

static const MVSide *sideOf(NSAppearance *look) {
  return MVIsDark(look) ? &kDark : &kLight;
}

BOOL MVStrongContrast(void) {
  return NSWorkspace.sharedWorkspace.accessibilityDisplayShouldIncreaseContrast;
}

BOOL MVSolidGrounds(void) {
  return NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency;
}

BOOL MVWithoutColor(void) {
  return NSWorkspace.sharedWorkspace.accessibilityDisplayShouldDifferentiateWithoutColor;
}

static NSColor *byLook(NSColor *(^of)(const MVSide *side)) {
  return [NSColor colorWithName:nil dynamicProvider:^NSColor *(NSAppearance *look) {
    return of(sideOf(look));
  }];
}

#define MVPLAIN(name, field)                      \
  NSColor *name(void) {                           \
    return byLook(^NSColor *(const MVSide *side) { \
      return hex(side->field, 1);                 \
    });                                           \
  }

MVPLAIN(MVInkColor, ink)
MVPLAIN(MVAccent, accent)
MVPLAIN(MVFillFrom, fillFrom)
MVPLAIN(MVFillTo, fillTo)
MVPLAIN(MVSurface, surface)
MVPLAIN(MVGreen, good)
MVPLAIN(MVOrange, watch)
MVPLAIN(MVRed, bad)
MVPLAIN(MVAgent, agent)

NSColor *MVQuietColor(void) {
  return byLook(^NSColor *(const MVSide *side) {
    return hex(MVStrongContrast() ? side->ink : side->quiet, 1);
  });
}

NSColor *MVCardFill(void) {
  return byLook(^NSColor *(const MVSide *side) {
    return MVSolidGrounds() || MVStrongContrast() ? hex(side->surface, 1) : hex(side->card, side->cardAlpha);
  });
}

NSColor *MVCardEdge(void) {
  return byLook(^NSColor *(const MVSide *side) {
    return MVStrongContrast() ? hex(side->ink, kStrongEdge) : hex(side->edge, side->edgeAlpha);
  });
}

NSColor *MVRule(double alpha) {
  return byLook(^NSColor *(const MVSide *side) {
    return hex(side->rule, MIN(1, MVStrongContrast() ? alpha * kStrongRule : alpha));
  });
}

static NSInteger hueAt(NSInteger at) {
  return ((at % kHues) + kHues) % kHues;
}

NSColor *MVHue(NSInteger at) {
  NSInteger hue = hueAt(at);
  return byLook(^NSColor *(const MVSide *side) {
    NSColor *mark = hex(side->hues[hue], 1);
    return MVStrongContrast() ? [mark blendedColorWithFraction:kStrongMark ofColor:hex(side->ink, 1)] : mark;
  });
}

NSColor *MVHueTile(NSInteger at) {
  NSInteger hue = hueAt(at);
  return byLook(^NSColor *(const MVSide *side) {
    return hex(side->tiles[hue], 1);
  });
}

NSColor *MVHeroMark(void) {
  return hex(kHeroMark, 1);
}

void MVGroundOf(BOOL dark, NSInteger place, MVGroundPlan *plan) {
  const MVSide *side = dark ? &kDark : &kLight;
  plan->ground = side->ground;
  // a person who asked for less transparency gets a plain ground: nothing moves under what they read
  plan->count = MVSolidGrounds() ? 0 : kBlooms;
  double strength = MVStrongContrast() ? kStrongGlow : 1;
  for (int i = 0; i < plan->count; i++) {
    // a place keeps the palette's shape and moves its colours round it, so the window takes on what stands in it. The last is
    // a small note of another colour, and stays the small one
    const MVBloom *shape = &side->blooms[i], *color = i < kBlooms - 1 ? &side->blooms[(i + place) % (kBlooms - 1)] : shape;
    plan->blooms[i] = (MVGroundBloom){shape->x, shape->y, shape->reach, (float)(shape->strength * strength), color->color};
  }
}
