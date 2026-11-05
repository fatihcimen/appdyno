// The hub's shell, with no device: what a person's real clicks do in its Inspector and capsule, and the places of its sidebar.
#import "SelfTest.h"
#import "Window.h"

static void pump(double seconds) {
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
  NSDictionary *tabs = @{@"tabFlows": @(MVPaneFlow), @"tabApps": @(MVPaneApps), @"tabActivity": @(MVPaneActivity), @"tabPerformance": @(MVPanePerf)};
  for (NSString *tab in tabs) {
    [window pokeClick:tab];
    pump(0.1);
    MVCheck([@"inspector: a real click chooses " stringByAppendingString:tab], window.inspector.chosen == [tabs[tab] integerValue], nil);
  }
  [window pokeClick:@"status"];
  pump(0.2);
  MVCheck(@"capsule: a real click shows the stream's numbers", window.numbersShown, nil);
  [window pokeClick:@"status"];
  pump(0.2);
  [window.nsWindow setContentSize:NSMakeSize(480, 700)];
  pump(0.3);
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
  line.client = @"Claude Code";
  MVCheck(@"capsule: an agent that says its name is named", [line.stringValue isEqual:@"Claude Code driving"], line.stringValue);
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
  NSWindow *window = hub.room.window;
  NSSplitViewItem *inspector = ((MVRoomView *)hub.room).slot.item;
  [window setContentSize:NSMakeSize(1000, 700)];
  pump(0.2);
  MVCheck(@"hub: under 1,100 wide the Inspector gives way, and the sidebar stays", inspector.collapsed && !hub.sidebarClosed, nil);
  [window setContentSize:NSMakeSize(800, 700)];
  pump(0.2);
  MVCheck(@"hub: under 860 wide the sidebar gives way too", hub.sidebarClosed, nil);
  [window setContentSize:NSMakeSize(1240, 820)];
  pump(0.2);
  MVCheck(@"hub: wide again, both come back", !inspector.collapsed && !hub.sidebarClosed, nil);
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
  checkLine();
  checkActivity();
  checkTabs();
  checkPlaces();
}
