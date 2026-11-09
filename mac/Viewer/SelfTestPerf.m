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

/// The fixture opened 4 s before read Steady at 19 fps for 231 s, the home screen's time before it.
static void checkHeldByApp(void) {
  NSWindow *window;
  MVPerfPane *pane = tallPane(&window);
  NSTextField *sentence = [pane valueForKey:@"_sentence"];
  [pane show:@{@"sample": @{@"at": @4, @"fps": @19, @"app": @"com.apple.springboard"}}];
  [pane setValue:@(MVNowMs() - 231000) forKey:@"_heldSince"];
  [pane show:@{@"sample": @{@"at": @5, @"fps": @19, @"app": @"dev.appdyno.fixture"}}];
  MVCheck(@"performance: an app just come to the front has held its rate for no time yet", [sentence.stringValue isEqual:@"Moving at 19 fps"], sentence.stringValue);
}

void MVCheckPerfPane(void) {
  checkDisplayRate();
  checkHeldByApp();
}
