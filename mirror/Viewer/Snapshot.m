// A window to a file as the window server composites it, materials and picture included, with no focus and
// whatever covers it: how a window is looked at on a Mac a person is using.
#import "Place.h"
#import "Viewer.h"
#import "Window.h"
#import <dlfcn.h>

typedef CGImageRef (*MVCapture)(CGRect, CGWindowListOption, CGWindowID, CGWindowImageOption);

@implementation MVOffscreenWindow
- (NSRect)constrainFrameRect:(NSRect)rect toScreen:(NSScreen *)screen {
  return self.offscreen ? rect : [super constrainFrameRect:rect toScreen:screen];
}
- (BOOL)isKeyWindow {
  return self.poses || super.isKeyWindow;
}
- (BOOL)isMainWindow {
  return self.poses || super.isMainWindow;
}

- (void)sendEvent:(NSEvent *)event {
  if (event.type == NSEventTypeLeftMouseDown || event.type == NSEventTypeRightMouseDown || event.type == NSEventTypeOtherMouseDown) self.personHere = YES;
  [super sendEvent:event];
}

- (void)resignKeyWindow {
  [super resignKeyWindow];
  self.personHere = NO;
}
@end

BOOL MVShortcutMayAct(NSEvent *_Nullable current, MVOffscreenWindow *window) {
  return current.type != NSEventTypeKeyDown || window.personHere;
}

/// `part` is in the window's own points, from its bottom left; empty for all of it.
BOOL MVWriteWindowPart(NSWindow *window, NSRect part, NSString *file) {
  // shortcut: the SDK hides this for ScreenCaptureKit, which asks a person for Screen Recording; a process's own
  // window needs no permission here. Move when macOS drops the symbol: a nil here refuses, and no window is harmed.
  MVCapture capture = (MVCapture)dlsym(RTLD_DEFAULT, "CGWindowListCreateImage");
  if (!capture) return NO;
  CGImageRef image = capture(CGRectNull, kCGWindowListOptionIncludingWindow, (CGWindowID)window.windowNumber, kCGWindowImageBoundsIgnoreFraming);
  if (!image) return NO;
  if (!NSIsEmptyRect(part)) {
    double scale = CGImageGetWidth(image) / window.frame.size.width;
    CGRect flipped = CGRectMake(part.origin.x * scale, (window.frame.size.height - NSMaxY(part)) * scale, part.size.width * scale, part.size.height * scale);
    CGImageRef cut = CGImageCreateWithImageInRect(image, flipped);
    CGImageRelease(image);
    image = cut;
    if (!image) return NO;
  }
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:image];
  CGImageRelease(image);
  return [[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:file atomically:YES];
}

void MVCopyImage(NSString *file) {
  NSImage *image = [[NSImage alloc] initWithContentsOfFile:file];
  if (!image) return;
  NSPasteboard *board = MVPlaceBoard();
  [board clearContents];
  [board writeObjects:@[image]];
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

static void addParts(NSView *view, NSView *top, double height, NSMutableArray *parts) {
  if (view.isHiddenOrHasHiddenAncestor || view.alphaValue < 0.05) return;
  NSString *text = [view isKindOfClass:NSTextField.class] ? ((NSTextField *)view).stringValue : [view isKindOfClass:NSButton.class] ? ((NSButton *)view).title : nil;
  NSImage *symbol = [view isKindOfClass:NSImageView.class] ? ((NSImageView *)view).image : [view isKindOfClass:NSButton.class] ? ((NSButton *)view).image : nil;
  if (text.length || symbol.size.width > 0 || [view isKindOfClass:MVInk.class]) {
    NSRect at = [view convertRect:view.bounds toView:top];
    [parts addObject:@{@"text": text ?: @"", @"kind": text.length ? @"text" : @"symbol", @"x": @(NSMinX(at)), @"y": @(height - NSMaxY(at)), @"w": @(at.size.width), @"h": @(at.size.height)}];
  }
  for (NSView *child in view.subviews) addParts(child, top, height, parts);
}

NSArray<NSDictionary *> *MVWindowParts(NSWindow *window) {
  NSView *top = window.contentView.superview;
  NSMutableArray *parts = [NSMutableArray array];
  addParts(top, top, top.bounds.size.height, parts);
  return parts;
}

BOOL MVWriteWindow(NSWindow *window, NSString *file) {
  return MVWriteWindowPart(window, NSZeroRect, file);
}
