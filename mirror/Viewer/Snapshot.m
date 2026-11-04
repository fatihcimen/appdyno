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
