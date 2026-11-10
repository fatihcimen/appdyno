// The hub's shell, with no device: what a person's real clicks do in its Inspector and capsule, and the places of its sidebar.
#import "Place.h"
#import "SelfTest.h"
#import "WindowParts.h"
#import "Words.h"

void MVPump(double seconds) {
  NSDate *end = [NSDate dateWithTimeIntervalSinceNow:seconds];
  while (end.timeIntervalSinceNow > 0)
    for (NSEvent *e; (e = [NSApp nextEventMatchingMask:NSEventMaskAny untilDate:[NSDate dateWithTimeIntervalSinceNow:0.02] inMode:NSDefaultRunLoopMode dequeue:YES]);) [NSApp sendEvent:e];
}

/// Before macOS 27 a table takes no click this test sends, whichever way, and takes one posted where a mouse's comes from, as
/// GitHub's macOS 15 and 26 runners show: it is the test that cannot click a row there, not a person.
static BOOL tablesTakeClicks(void) {
  return [NSProcessInfo.processInfo isOperatingSystemAtLeastVersion:(NSOperatingSystemVersion){27, 0, 0}];
}

void MVPokeListRow(MVList *list, NSString *title) {
  NSUInteger at = [[list.rows valueForKey:@"title"] indexOfObject:MVWord(title)];
  if (at == NSNotFound) return;
  [list.window layoutIfNeeded];
  [list.window displayIfNeeded];
  if (tablesTakeClicks()) return MVRealClick(list.window, [list pointOfRow:at]);
  // the table's own choosing, which its click would have set off
  [list selectKey:list.rows[at].key];
}

void MVPokeRow(MVHub *hub, NSString *title) {
  MVPokeListRow([hub valueForKey:@"_list"], title);
}

void MVCheckRowClick(NSString *name, BOOL ok, NSString *_Nullable detail) {
  if (tablesTakeClicks()) MVCheck(name, ok, detail);
  else MVSkip(name, @"before macOS 27 a table takes no click a test sends, only a person's");
}

/// Ten symbols in a row of their own, each whole and apart in the Inspector's width, and the pane's name on a line under them.
static void checkHeader(MVWindow *window) {
  NSRect inspector = window.inspectorInWindow;
  NSMutableArray<NSString *> *wrong = [NSMutableArray array];
  double right = NSMinX(inspector), bottom = NSMaxY(inspector);
  for (int i = 0; i < MVPanes; i++) {
    NSButton *tab = MVFindControl(window.inspector, @[@"tabPerformance", @"tabFlows", @"tabApps", @"tabActivity", @"tabLogs", @"tabNetwork", @"tabAccessibility", @"tabDevice", @"tabLinks", @"tabPush"][i]);
    NSRect at = [tab convertRect:tab.bounds toView:nil];
    if (!tab || !NSContainsRect(inspector, at) || NSMinX(at) < right || at.size.width < 24 || !tab.accessibilityLabel.length) [wrong addObject:tab.identifier ?: @"none"];
    right = NSMaxX(at);
    bottom = MIN(bottom, NSMinY(at));
  }
  MVCheck(@"inspector: ten symbols stand in its width, each whole, apart and named", wrong.count == 0, [wrong componentsJoinedByString:@" "]);
  NSTextField *name = [window.inspector valueForKey:@"_paneName"];
  NSRect title = [name convertRect:name.bounds toView:nil];
  MVCheck(@"inspector: the pane's name stands whole on a line under them", NSMaxY(title) <= bottom && name.intrinsicContentSize.width <= title.size.width && [name.stringValue isEqual:MVWord(@"Performance")], NSStringFromRect(title));
}

static void checkTabs(void) {
  MVWindow *window = [MVWindow new];
  window.behind = YES;
  [window configure:@{@"title": @"tabs",
                      @"look": @{@"controls": @[@"home"]}}];
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
  checkHeader(window);
  NSDictionary *tabs = @{@"tabFlows": @(MVPaneFlow),
                         @"tabApps": @(MVPaneApps),
                         @"tabActivity": @(MVPaneActivity),
                         @"tabPerformance": @(MVPanePerf),
                         @"tabLogs": @(MVPaneLogs),
                         @"tabNetwork": @(MVPaneNetwork),
                         @"tabAccessibility": @(MVPaneAccessibility),
                         @"tabDevice": @(MVPaneDevice),
                         @"tabLinks": @(MVPaneLinks),
                         @"tabPush": @(MVPanePush)};
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
  for (int i = 0; i < 3; i++) [window addActivity:@{@"at": @(i * 1000),
                                                    @"tool": @"tap",
                                                    @"ok": @YES,
                                                    @"ms": @3,
                                                    @"time": @"12:00"}];
  [window.nsWindow displayIfNeeded];
  MVPump(0.1);
  NSUInteger open = window.inspector.activity.lines;
  MVRealClick(window.nsWindow, window.inspector.activity.firstLinePoint);
  MVPump(0.2);
  MVCheckRowClick(@"activity: a real click folds a run away", open == 4 && window.inspector.activity.lines == 1, [NSString stringWithFormat:@"%lu then %lu", (unsigned long)open, (unsigned long)window.inspector.activity.lines]);
  MVRealClick(window.nsWindow, window.inspector.activity.firstLinePoint);
  MVPump(0.2);
  MVCheckRowClick(@"activity: and opens it again", window.inspector.activity.lines == 4, nil);
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
  MVCheck(@"capsule: live says its rate and how it is joined", [line.stringValue isEqual:@"Live · Picture 60 fps · USB"], line.stringValue);
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
  // the line joins its own words, and the capsule says each of them: a sentence keeps what is joined to it as it came
  MVStatusLine *live = [MVStatusLine new];
  live.state = @"Live";
  live.live = YES;
  live.rate = 60;
  live.link = @"USB";
  MVCapsule *capsule = [[MVCapsule alloc] initWithFrame:NSMakeRect(0, 0, 200, 28)];
  MVTestTurkish(YES);
  [capsule show:live];
  MVTestTurkish(NO);
  MVCheck(@"capsule: each of its own words is said in Turkish", [capsule.words isEqual:@"Canlı · Görüntü 60 fps · USB"], capsule.words);
}

static void checkActivity(void) {
  MVActivityPane *pane = [[MVActivityPane alloc] initWithFrame:NSMakeRect(0, 0, 288, 400)];
  for (int i = 0; i < 23; i++) [pane add:@{@"at": @(1000 + i * 1000),
                                           @"tool": @"tap",
                                           @"ok": @YES,
                                           @"ms": @3,
                                           @"time": @"12:00",
                                           @"done": @"Tapped Sign in"}];
  MVCheck(@"activity: calls close together are one run, said in a line", [pane.firstLine isEqual:@"Worked for 22 s · 23 calls"], pane.firstLine);
  [pane add:@{@"at": @(100000),
              @"tool": @"tap",
              @"ok": @YES,
              @"ms": @3,
              @"time": @"12:01"}];
  MVCheck(@"activity: a gap starts a new run, which stands first", [pane.firstLine isEqual:@"Worked for 1 s · 1 call"], pane.firstLine);
}

/// An agent that never stops for 20 s is one run for an hour: it keeps its newest calls, as the pane keeps its newest runs.
static void checkLongRun(void) {
  MVActivityPane *busy = [[MVActivityPane alloc] initWithFrame:NSMakeRect(0, 0, 288, 400)];
  for (int i = 0; i < 250; i++) [busy add:@{@"at": @(1000 + i * 1000),
                                            @"tool": @"tap",
                                            @"ok": @YES,
                                            @"ms": @3,
                                            @"time": @"12:00",
                                            @"done": @"Tapped Sign in"}];
  MVCheck(@"activity: one run that never pauses keeps its newest 200 calls, and counts them all", busy.lines == 201 && [busy.firstLine isEqual:@"Worked for 4 min · 250 calls"], [NSString stringWithFormat:@"%lu lines, %@", (unsigned long)busy.lines, busy.firstLine]);
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
  MVCheck(@"hub: the keyboard starts on the list, with no caret blinking in Search", [hub.room.window.initialFirstResponder isKindOfClass:NSTableView.class], nil);
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

/// A phone off its cable that runs by Wi-Fi is one phone, and needs nothing of a person; gone every way, it does.
static void checkGoneAnotherWay(void) {
  MVHub *hub = [[MVHub alloc] initWithShow:MVShowBehind poses:NO];
  NSString *network = @"adb-R5C-Ab._adb-tls-connect._tcp";
  NSDictionary *cable = @{@"id": @"R5C", @"serial": @"R5C", @"kind": @"phone", @"state": @"running", @"name": @"Test Phone", @"link": @"USB"};
  NSDictionary *wifi = @{@"id": network, @"serial": network, @"kind": @"phone", @"state": @"running", @"name": @"Test Phone", @"detail": @"Wi-Fi", @"link": @"Wi-Fi", @"sameAs": @"R5C"};
  [hub show:@{@"devices": @[cable],
              @"showing": @"R5C"}];
  [hub show:@{@"devices": @[wifi]}];
  NSString *needs = MVWord(@"Needs You");
  MVCheck(@"sidebar: a phone off its cable that runs by Wi-Fi is not under Needs You", ![hub.rowTitles containsObject:needs] && [hub.rowTitles containsObject:MVWord(@"Running")], [hub.rowTitles componentsJoinedByString:@"|"]);
  [hub show:@{@"devices": @[]}];
  MVCheck(@"sidebar: gone every way, it is", [hub.rowTitles containsObject:needs], [hub.rowTitles componentsJoinedByString:@"|"]);
  // and the other way: chosen by Wi-Fi, its cable back, the network row gives way to the cable's
  MVHub *back = [[MVHub alloc] initWithShow:MVShowBehind poses:NO];
  [back show:@{@"devices": @[wifi],
               @"showing": network}];
  [back show:@{@"devices": @[cable]}];
  MVCheck(@"sidebar: nor is one on its cable again after Wi-Fi", ![back.rowTitles containsObject:needs], [back.rowTitles componentsJoinedByString:@"|"]);
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

/// After a viewer came back, an iPhone's bar said iPhone 13 Pro Max twice, its model under its name.
static void checkOneName(void) {
  MVWindow *window = [MVWindow new];
  window.behind = YES;
  [window configure:@{@"title": @"00001234-0123456789ABCDEF",
                      @"look": @{@"name": @"iPhone 13 Pro Max", @"frame": @{@"model": @"iPhone 13 Pro Max", @"platform": @"ios"}, @"controls": @[@"home"]}}];
  NSTextField *about = [[window valueForKey:@"_bar"] valueForKey:@"_about"];
  MVCheck(@"bar: a model that is the device's name is said once", about.hidden, about.stringValue);
}

void MVCheckShell(void) {
  checkOneName();
  checkMotion();
  checkStateMoves();
  checkLine();
  checkActivity();
  checkLongRun();
  checkTabs();
  checkPlaces();
  checkGoneAnotherWay();
}
