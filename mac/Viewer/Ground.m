// The ground of a window, painted small and stretched by the GPU: no blur pass, no mask and no filter under a live picture, and
// nothing at all to do while it stays as it is. A still grain over it keeps a slow gradient from showing bands.
#import "Window.h"

enum { kWide = 128, kTall = 84, kGrain = 192 };
static const double kGrainAlpha = 0.012;

static double linear(uint32_t channel) {
  double v = channel / 255.0;
  return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4);
}

static uint8_t gamma8(double v) {
  v = MAX(0, MIN(1, v));
  return (uint8_t)(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * pow(v, 1 / 2.4) - 0.055) + 0.5);
}

static void oklabOf(uint32_t color, double out[3]) {
  double r = linear(color >> 16 & 255), g = linear(color >> 8 & 255), b = linear(color & 255);
  double l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  double m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  double s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  out[0] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  out[1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
}

static void pixelOf(const double lab[3], uint8_t *px) {
  double l = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2];
  double m = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2];
  double s = lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2];
  l = l * l * l, m = m * m * m, s = s * s * s;
  px[0] = gamma8(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  px[1] = gamma8(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  px[2] = gamma8(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
  px[3] = 255;
}

/// In a space made for the eye, so that a glow's edge stays soft and two colours meet in a colour and not in mud.
CGImageRef MVPaintGround(const MVGroundPlan *plan) {
  double base[3], colors[MVGroundBlooms][3];
  oklabOf(plan->ground, base);
  for (int b = 0; b < plan->count; b++) oklabOf(plan->blooms[b].color, colors[b]);
  uint8_t *pixels = malloc(kWide * kTall * 4);
  double aspect = (double)kTall / kWide;
  for (int y = 0; y < kTall; y++) {
    for (int x = 0; x < kWide; x++) {
      double out[3] = {base[0], base[1], base[2]}, u = (x + 0.5) / kWide, v = (y + 0.5) / kTall;
      for (int b = 0; b < plan->count; b++) {
        const MVGroundBloom *bloom = &plan->blooms[b];
        double dx = u - bloom->x, dy = (v - bloom->y) * aspect, reach = bloom->reach;
        double share = bloom->strength * exp(-(dx * dx + dy * dy) / (reach * reach));
        for (int i = 0; i < 3; i++) out[i] += (colors[b][i] - out[i]) * share;
      }
      pixelOf(out, pixels + (y * kWide + x) * 4);
    }
  }
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(pixels, kWide, kTall, 8, kWide * 4, space, (CGBitmapInfo)kCGImageAlphaNoneSkipLast);
  CGImageRef image = CGBitmapContextCreateImage(context);
  CGContextRelease(context);
  CGColorSpaceRelease(space);
  free(pixels);
  return image;
}

CGColorRef MVGrain(void) {
  static CGColorRef grain;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:kGrain pixelsHigh:kGrain bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
    uint8_t *px = rep.bitmapData;
    for (NSInteger i = 0; i < rep.bytesPerRow * kGrain; i += 4) {
      // premultiplied: half lighter and half darker, and so no change of the ground as a whole
      uint8_t alpha = (uint8_t)(arc4random_uniform(256) * kGrainAlpha), level = arc4random_uniform(2) ? alpha : 0;
      px[i] = px[i + 1] = px[i + 2] = level;
      px[i + 3] = alpha;
    }
    NSImage *tile = [[NSImage alloc] initWithSize:NSMakeSize(kGrain / 2.0, kGrain / 2.0)];
    [tile addRepresentation:rep];
    grain = CGColorRetain([NSColor colorWithPatternImage:tile].CGColor);
  });
  return grain;
}
