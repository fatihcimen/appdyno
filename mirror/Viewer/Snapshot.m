// A window to a file as the window server composites it, materials and picture included, with no focus and
// whatever covers it: how a window is looked at on a Mac a person is using.
#import "Viewer.h"
#import "Window.h"
#import <dlfcn.h>

typedef CGImageRef (*MVCapture)(CGRect, CGWindowListOption, CGWindowID, CGWindowImageOption);

BOOL MVWriteWindow(NSWindow *window, NSString *file) {
  // shortcut: the SDK hides this for ScreenCaptureKit, which asks a person for Screen Recording; a process's own
  // window needs no permission here. Move when macOS drops the symbol: a nil here refuses, and no window is harmed.
  MVCapture capture = (MVCapture)dlsym(RTLD_DEFAULT, "CGWindowListCreateImage");
  if (!capture) return NO;
  CGImageRef image = capture(CGRectNull, kCGWindowListOptionIncludingWindow, (CGWindowID)window.windowNumber, kCGWindowImageBoundsIgnoreFraming);
  if (!image) return NO;
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:image];
  CGImageRelease(image);
  return [[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:file atomically:YES];
}

void MVCopyImage(NSString *file) {
  NSImage *image = [[NSImage alloc] initWithContentsOfFile:file];
  if (!image) return;
  [NSPasteboard.generalPasteboard clearContents];
  [NSPasteboard.generalPasteboard writeObjects:@[image]];
}

enum { kMoodColumns = 5, kMoodRows = 9, kMoodSamples = 6 };

/// A cell's colour, from a sparse sample: this runs on the window's thread.
static void cellOf(const uint8_t *base, size_t row, size_t x0, size_t y0, size_t w, size_t h, double out[3]) {
  double sum[3] = {0, 0, 0};
  for (int i = 0; i < kMoodSamples; i++) {
    for (int j = 0; j < kMoodSamples; j++) {
      const uint8_t *p = base + (y0 + h * i / kMoodSamples) * row + (x0 + w * j / kMoodSamples) * 4;
      sum[0] += p[2], sum[1] += p[1], sum[2] += p[0];
    }
  }
  for (int i = 0; i < 3; i++) out[i] = sum[i] / (kMoodSamples * kMoodSamples) / 255;
}

CGImageRef MVPictureMood(IOSurfaceRef surface, BOOL dark) {
  if (IOSurfaceGetBytesPerElement(surface) != 4 || IOSurfaceLock(surface, kIOSurfaceLockReadOnly, NULL) != kIOReturnSuccess) return NULL;
  size_t width = IOSurfaceGetWidth(surface), height = IOSurfaceGetHeight(surface), row = IOSurfaceGetBytesPerRow(surface);
  const uint8_t *base = IOSurfaceGetBaseAddress(surface);
  uint8_t cells[kMoodRows * kMoodColumns * 4];
  for (int y = 0; y < kMoodRows; y++) {
    for (int x = 0; x < kMoodColumns; x++) {
      double c[3];
      cellOf(base, row, width * x / kMoodColumns, height * y / kMoodRows, width / kMoodColumns, height / kMoodRows, c);
      double luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      uint8_t *out = cells + (y * kMoodColumns + x) * 4;
      for (int i = 0; i < 3; i++) {
        // richer than the picture, and always behind it: dark stays dark and light stays light, whatever is on screen
        double rich = MAX(0, MIN(1, luma + (c[i] - luma) * 1.7));
        out[i] = (uint8_t)(255 * (dark ? 0.05 + rich * 0.5 : 0.56 + rich * 0.42));
      }
      out[3] = 255;
    }
  }
  IOSurfaceUnlock(surface, kIOSurfaceLockReadOnly, NULL);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(cells, kMoodColumns, kMoodRows, 8, kMoodColumns * 4, space, (CGBitmapInfo)kCGImageAlphaNoneSkipLast);
  CGImageRef image = CGBitmapContextCreateImage(context);
  CGContextRelease(context);
  CGColorSpaceRelease(space);
  return image;
}

NSButton *_Nullable MVFindControl(NSView *view, NSString *name) {
  if ([view isKindOfClass:NSButton.class] && [view.identifier isEqual:name]) return (NSButton *)view;
  NSMutableArray<NSView *> *inside = [NSMutableArray arrayWithArray:view.subviews];
  if ([view respondsToSelector:@selector(contentView)]) {
    NSView *content = [(id)view contentView];
    if (content) [inside addObject:content];
  }
  for (NSView *child in inside) {
    NSButton *found = MVFindControl(child, name);
    if (found) return found;
  }
  return nil;
}
