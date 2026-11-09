// The Performance pane as a phone's window showed it, in a pane as tall as an Inspector in the hub.
#import "SelfTest.h"
#import "Window.h"

static MVPerfPane *tallPane(NSWindow **window) {
  MVPerfPane *pane = [[MVPerfPane alloc] initWithFrame:NSMakeRect(0, 0, 276, 1000) target:NSNull.null];
  *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 320, 1100) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
  [(*window).contentView addSubview:pane];
  [*window display];
  return pane;
}

/// An iPhone's card said App frame rate over its own note that the rate is the display's.
static void checkDisplayRate(void) {
  NSWindow *window;
  MVPerfPane *pane = tallPane(&window);
  NSTextField *title = [[[pane valueForKey:@"_trends"] firstObject] valueForKey:@"title"];
  [pane show:@{@"sample": @{@"at": @3, @"fps": @20, @"absent": @{@"fps": @"the display, not the app: a mirror alone keeps it near 20"}}}];
  MVCheck(@"performance: an iPhone's display rate is called no app's", [title.stringValue isEqual:@"Frame rate"], title.stringValue);
}

void MVCheckPerfPane(void) {
  checkDisplayRate();
}
