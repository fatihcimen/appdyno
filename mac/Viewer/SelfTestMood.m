// The backdrop's mood, drawn from a device's own picture, with no window: from a surface and from each kind of stream.
#import "SelfTest.h"
#import "Window.h"

static void checkMood(void) {
  NSDictionary *shape = @{(id)kIOSurfaceWidth: @64,
                          (id)kIOSurfaceHeight: @64,
                          (id)kIOSurfaceBytesPerElement: @4,
                          (id)kIOSurfacePixelFormat: @(kCVPixelFormatType_32BGRA)};
  IOSurfaceRef surface = IOSurfaceCreate((__bridge CFDictionaryRef)shape);
  IOSurfaceLock(surface, 0, NULL);
  memset(IOSurfaceGetBaseAddress(surface), 255, IOSurfaceGetAllocSize(surface));
  IOSurfaceUnlock(surface, 0, NULL);
  CGImageRef dark = MVPictureMood(surface, YES), light = MVPictureMood(surface, NO);
  MVCheck(@"backdrop: a picture gives a mood, light and dark", dark && light, nil);
  uint8_t px[2][4];
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  for (int i = 0; i < 2; i++) {
    CGContextRef c = CGBitmapContextCreate(px[i], 1, 1, 8, 4, space, (CGBitmapInfo)kCGImageAlphaNoneSkipLast);
    CGContextDrawImage(c, CGRectMake(0, 0, 1, 1), i ? light : dark);
    CGContextRelease(c);
  }
  CGColorSpaceRelease(space);
  // a white screen must not lift a dark window to white: what floats over it has to stay readable
  MVCheck(@"backdrop: a white picture stays dim in dark, and light in light", px[0][0] < 160 && px[1][0] > 230, nil);
  if (dark) CGImageRelease(dark);
  if (light) CGImageRelease(light);
  CFRelease(surface);
}

/// One corner's colour of a mood, as its first byte in each channel.
static void moodCorner(CGImageRef mood, uint8_t px[4]) {
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef c = CGBitmapContextCreate(px, 1, 1, 8, 4, space, (CGBitmapInfo)kCGImageAlphaNoneSkipLast);
  CGContextDrawImage(c, CGRectMake(0, 0, 1, 1), mood);
  CGContextRelease(c);
  CGColorSpaceRelease(space);
}

/// Red, as a stream carries it, in a kind of image of `lines` lines of colours.
static BOOL redMood(OSType format, size_t lines, NSString *name) {
  CVPixelBufferRef image = NULL;
  CVPixelBufferCreate(NULL, 64, 64, format, NULL, &image);
  CVPixelBufferLockBaseAddress(image, 0);
  memset(CVPixelBufferGetBaseAddressOfPlane(image, 0), 63, CVPixelBufferGetBytesPerRowOfPlane(image, 0) * 64);
  uint8_t *chroma = CVPixelBufferGetBaseAddressOfPlane(image, 1);
  for (size_t i = 0; i < CVPixelBufferGetBytesPerRowOfPlane(image, 1) * lines; i += 2) {
    chroma[i] = 102;
    chroma[i + 1] = 240;
  }
  CVPixelBufferUnlockBaseAddress(image, 0);
  CGImageRef mood = MVImageMood(image, NO);
  uint8_t px[4] = {0};
  if (mood) moodCorner(mood, px);
  BOOL red = mood && px[0] > px[1] + 40 && px[0] > px[2] + 40;
  MVCheck(name, red, [NSString stringWithFormat:@"%d %d %d", px[0], px[1], px[2]]);
  if (mood) CGImageRelease(mood);
  CVPixelBufferRelease(image);
  return red;
}

static void checkStreamMood(void) {
  redMood(kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, 32, @"backdrop: a stream's own colours reach the window");
  redMood(kCVPixelFormatType_444YpCbCr8BiPlanarFullRange, 64, @"backdrop: an iPhone's 4:4:4 stream gives its colours too");
  CVPixelBufferRef ten = NULL;
  CVPixelBufferCreate(NULL, 64, 64, kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange, NULL, &ten);
  CGImageRef none = ten ? MVImageMood(ten, NO) : NULL;
  MVCheck(@"backdrop: a kind of image it cannot read leaves the window as it was", ten && !none, nil);
  if (none) CGImageRelease(none);
  CVPixelBufferRelease(ten);
}

void MVCheckMood(void) {
  checkMood();
  checkStreamMood();
}
