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

/// On an iPhone the card stood bare after Measure Launch, as the room under it went to the space below.
static void checkKeptResult(void) {
  NSWindow *window;
  MVPerfPane *pane = tallPane(&window);
  [pane showHistory:@{@"results": @[],
                      @"app": @"appdyno fixture"}];
  [window display];
  [pane showMeasured:@{@"ok": @YES,
                       @"title": @"Cold launch",
                       @"value": @"1754 ms",
                       @"kept": @YES}];
  [pane showHistory:@{@"results": @[@{@"ok": @YES,
                                      @"title": @"Cold launch",
                                      @"value": @"1754 ms",
                                      @"detail": @"1 second ago"}],
                      @"app": @"appdyno fixture"}];
  MVPump(0.5);
  [window display];
  MVList *list = [pane valueForKey:@"_results"];
  NSView *row = [(NSTableView *)list.documentView rowViewAtRow:0 makeIfNecessary:NO];
  MVCheck(@"performance: a result the Mac kept stands whole in its card", row && NSWidth(row.frame) > 100 && NSContainsRect(list.documentVisibleRect, row.frame),
          [NSString stringWithFormat:@"row %@ shown %@", NSStringFromRect(row.frame), NSStringFromRect(list.documentVisibleRect)]);
}

/// A Xiaomi with its screen off: the row's line read `Nothing that can be…not an app of yours`, cut in its middle.
static void checkRefusedWhole(void) {
  NSWindow *window;
  MVPerfPane *pane = tallPane(&window);
  NSString *what = @"Wake the device if its screen is off, open one of your apps, then measure it.";
  [pane showMeasured:@{@"title": @"Open an app first",
                       @"detail": @"No app is in front",
                       @"hint": what}];
  [window layoutIfNeeded];
  NSTextField *hint = [pane valueForKey:@"_hint"];
  NSRect needed = [hint.attributedStringValue boundingRectWithSize:NSMakeSize(NSWidth(hint.frame) - 4, CGFLOAT_MAX) options:NSStringDrawingUsesLineFragmentOrigin];
  MVCheck(@"performance: what to do when no app of yours is in front is said whole", !hint.hidden && [hint.stringValue isEqual:what] && NSHeight(hint.frame) >= NSHeight(needed) - 1, [NSString stringWithFormat:@"%.0f for %.0f", NSHeight(hint.frame), NSHeight(needed)]);
}

void MVCheckPerfPane(void) {
  checkDisplayRate();
  checkHeldByApp();
  checkKeptResult();
  checkRefusedWhole();
}
