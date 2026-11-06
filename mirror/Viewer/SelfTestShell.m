// The hub's shell, with no device: what a person's real clicks do in its Inspector and capsule, and the places of its sidebar.
#import "Place.h"
#import "SelfTest.h"
#import "WindowParts.h"

void MVPump(double seconds) {
  NSDate *end = [NSDate dateWithTimeIntervalSinceNow:seconds];
  while (end.timeIntervalSinceNow > 0)
    for (NSEvent *e; (e = [NSApp nextEventMatchingMask:NSEventMaskAny untilDate:[NSDate dateWithTimeIntervalSinceNow:0.02] inMode:NSDefaultRunLoopMode dequeue:YES]);) [NSApp sendEvent:e];
}

static void checkTabs(void) {
  MVWindow *window = [MVWindow new];
  window.behind = YES;
  [window configure:@{@"title": @"tabs", @"look": @{@"controls": @[@"home"]}}];
  [window.nsWindow setContentSize:NSMakeSize(1200, 800)];
  [window showPane:MVPanePerf];
  [window.nsWindow displayIfNeeded];
  MVCheck(@"inspector: it opens when a pane is asked for", window.inspecting, nil);
  // the order that matters: a picture standing, and the Inspector opening beside it
  [window openInspector:NO];
  MVPump(0.3);
  [window setPicture:CGSizeMake(400, 860)];
  MVPump(0.2);
  [window openInspector:YES];
  MVPump(0.5);
  MVCheck(@"inspector: nothing stands over the device, as the ground runs on under it", NSMaxX(window.deviceInWindow) <= NSMinX(window.inspectorInWindow), [NSString stringWithFormat:@"device to %.0f, Inspector from %.0f", NSMaxX(window.deviceInWindow), NSMinX(window.inspectorInWindow)]);
  NSDictionary *tabs = @{@"tabFlows": @(MVPaneFlow), @"tabApps": @(MVPaneApps), @"tabActivity": @(MVPaneActivity), @"tabPerformance": @(MVPanePerf)};
  for (NSString *tab in tabs) {
    [window pokeClick:tab];
    MVPump(0.1);
    MVCheck([@"inspector: a real click chooses " stringByAppendingString:tab], window.inspector.chosen == [tabs[tab] integerValue], nil);
  }
  [window showPane:MVPaneFlow];
  MVPump(0.2);
  NSDictionary *clicks = @{@"clickDoes:1": @"copy", @"clickDoes:2": @"assert"};
  for (NSString *name in clicks) {
    [window pokeClick:name];
    MVPump(0.1);
    MVCheck([@"flow: a real click on a capsule chooses " stringByAppendingString:clicks[name]], [window.inspector.flow.clickDoes isEqual:clicks[name]], window.inspector.flow.clickDoes);
  }
  [window pokeClick:@"clickDoes:0"];
  MVPump(0.1);
  MVCheck(@"flow: and the first gives a click back to the device", window.inspector.flow.clickDoes == nil, window.inspector.flow.clickDoes);
  [window pokeClick:@"status"];
  MVPump(0.2);
  MVCheck(@"capsule: a real click shows the stream's numbers", window.numbersShown, nil);
  [window pokeClick:@"status"];
  MVPump(0.2);
  [window showPane:MVPaneActivity];
  for (int i = 0; i < 3; i++) [window addActivity:@{@"at": @(i * 1000), @"tool": @"tap", @"ok": @YES, @"ms": @3, @"time": @"12:00"}];
  [window.nsWindow displayIfNeeded];
  MVPump(0.1);
  NSUInteger open = window.inspector.activity.lines;
  MVRealClick(window.nsWindow, window.inspector.activity.firstLinePoint);
  MVPump(0.2);
  MVCheck(@"activity: a real click folds a run away", open == 4 && window.inspector.activity.lines == 1, [NSString stringWithFormat:@"%lu then %lu", (unsigned long)open, (unsigned long)window.inspector.activity.lines]);
  MVRealClick(window.nsWindow, window.inspector.activity.firstLinePoint);
  MVPump(0.2);
  MVCheck(@"activity: and opens it again", window.inspector.activity.lines == 4, nil);
  [window setStatus:@{@"state": @"waiting", @"title": @"The screen is off", @"fix": @"Wake the device."}];
  [window pokeClick:@"tryAgain"];
  MVPump(0.2);
  MVCheck(@"overlay: Try Again stands where a real click reaches it", MVFindControl(window.nsWindow.contentView, @"tryAgain") != nil, nil);
  [window setStatus:@{@"state": @"live"}];
  [window.nsWindow setContentSize:NSMakeSize(480, 700)];
  MVPump(0.3);
  MVCheck(@"inspector: a narrow window takes it away by itself", !window.inspecting, [NSString stringWithFormat:@"%.0f wide", window.nsWindow.frame.size.width]);
}

static void checkLine(void) {
  MVStatusLine *line = [MVStatusLine new];
  line.state = @"Live";
  line.live = YES;
  line.rate = 60;
  line.link = @"USB";
  MVCheck(@"capsule: live says its rate and how it is joined", [line.stringValue isEqual:@"Live · 60 fps · USB"], line.stringValue);
  line.tool = @"tap";
  MVCheck(@"capsule: an agent with no name is still said, in purple", [line.stringValue isEqual:@"AI client driving"] && line.tone == MVToneAgent, line.stringValue);
  line.client = @"Some Client";
  MVCheck(@"capsule: an agent that says its name is named", [line.stringValue isEqual:@"Some Client driving"], line.stringValue);
  line.measuring = @"Measuring launch 3 of 6";
  MVCheck(@"capsule: a measure comes before who drives", [line.stringValue containsString:@"3 of 6"] && line.tone == MVToneBusy, line.stringValue);
  line.measuring = nil;
  line.live = NO;
  line.stuck = YES;
  line.state = @"The screen is off";
  MVCheck(@"capsule: what holds a device up comes before all but a failure", [line.stringValue isEqual:@"The screen is off"] && line.tone == MVToneNeedsYou, line.stringValue);
}

static void checkActivity(void) {
  MVActivityPane *pane = [[MVActivityPane alloc] initWithFrame:NSMakeRect(0, 0, 288, 400)];
  for (int i = 0; i < 23; i++) [pane add:@{@"at": @(1000 + i * 1000), @"tool": @"tap", @"ok": @YES, @"ms": @3, @"time": @"12:00", @"done": @"Tapped Sign in"}];
  MVCheck(@"activity: calls close together are one run, said in a line", [pane.firstLine isEqual:@"Worked for 22 s · 23 calls"], pane.firstLine);
  [pane add:@{@"at": @(100000), @"tool": @"tap", @"ok": @YES, @"ms": @3, @"time": @"12:01"}];
  MVCheck(@"activity: a gap starts a new run, which stands first", [pane.firstLine isEqual:@"Worked for 1 s · 1 call"], pane.firstLine);
}

static void checkPlaces(void) {
  MVHub *hub = [[MVHub alloc] initWithShow:MVShowBehind poses:NO];
  [hub show:@{@"devices": @[]}];
  NSView *room = [NSView new];
  MVPlace *place = [MVPlace new];
  place.title = @"Help";
  place.symbol = @"questionmark.circle";
  place.view = room;
  [hub addPlace:place];
  MVCheck(@"sidebar: a place has its row, under the devices", [hub.rowTitles containsObject:@"Help"], [hub.rowTitles componentsJoinedByString:@"|"]);
  [hub choosePlace:place];
  MVCheck(@"sidebar: a place takes the room", room.superview == hub.room, nil);
  [hub leavePlaceFor:@{}];
  NSWindow *window = hub.room.window;
  NSSplitViewItem *inspector = ((MVRoomView *)hub.room).slot.item;
  [window setContentSize:NSMakeSize(1000, 700)];
  MVPump(0.2);
  MVCheck(@"hub: under 1,100 wide the Inspector gives way, and the sidebar stays", inspector.collapsed && !hub.sidebarClosed, nil);
  [window setContentSize:NSMakeSize(800, 700)];
  MVPump(0.2);
  MVCheck(@"hub: under 860 wide the sidebar gives way too", hub.sidebarClosed, nil);
  [window setContentSize:NSMakeSize(1240, 820)];
  MVPump(0.2);
  MVCheck(@"hub: wide again, both come back", !inspector.collapsed && !hub.sidebarClosed, nil);
}

static NSInteger passedUnder(NSView *view) {
  NSInteger count = [view isKindOfClass:NSClassFromString(@"MVStepMark")] && [[view valueForKey:@"passed"] boolValue] ? 1 : 0;
  for (NSView *sub in view.subviews) count += passedUnder(sub);
  return count;
}

static void checkStateMoves(void) {
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 300, 60) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
  MVCapsule *capsule = [[MVCapsule alloc] initWithFrame:NSMakeRect(0, 0, 200, 28)];
  [window.contentView addSubview:capsule];
  MVStatusLine *line = [MVStatusLine new];
  line.live = YES;
  line.state = @"Live";
  line.rate = 60;
  [capsule show:line];
  // a window never ordered in has no layers until it is drawn, and an animation given to none is never there
  [window display];
  NSTextField *words = [capsule valueForKey:@"_words"];
  line.rate = 61;
  [capsule show:line];
  MVCheck(@"motion: a reading changes at once: a number is no state", words.layer && [capsule.words containsString:@"61"] && ![words.layer animationForKey:kCATransition], capsule.words);
  line.failing = @"Lost it";
  [capsule show:line];
  MVCheck(@"motion: a state crosses over", [words.layer animationForKey:kCATransition] != nil, nil);
  MVStepper *stepper = MVNewStepper();
  [stepper showItems:@[@{@"title": @"One", @"state": @"done"}, @{@"title": @"Two", @"state": @"now"}]];
  MVCheck(@"motion: what a window opens on is old news, and no step passes", passedUnder(stepper) == 0, nil);
  [stepper showItems:@[@{@"title": @"One", @"state": @"done"}, @{@"title": @"Two", @"state": @"done"}]];
  MVCheck(@"motion: a step seen undone is seen to pass, and that one only", passedUnder(stepper) == 1, nil);
}

static void checkMotion(void) {
  CALayer *layer = [CALayer layer];
  MVHoldStill(YES);
  MVFade(layer, 0, 1, 0.2);
  MVCheck(@"motion: with less asked for, a fade is a cut", ![layer animationForKey:@"fade"] && layer.opacity == 1, nil);
  MVHoldStill(NO);
  MVFade(layer, 1, 0, 0.2);
  MVCheck(@"motion: otherwise it fades, and ends where it was told", [layer animationForKey:@"fade"] && layer.opacity == 0, nil);
}

void MVCheckShell(void) {
  checkMotion();
  checkStateMoves();
  checkLine();
  checkActivity();
  checkTabs();
  checkPlaces();
}
