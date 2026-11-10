// The Logs, Network and Accessibility panes in a window kept behind: each asks the parent to read only while it shows,
// says what it is told, and does nothing to the device a person did not ask for.
#import "Place.h"
#import "SelfTest.h"
#import "WindowParts.h"
#import "Words.h"

static MVWindow *paneWindow(NSString *title) {
  MVWindow *window = [MVWindow new];
  window.behind = YES;
  [window configure:@{@"title": title,
                      @"look": @{@"controls": @[@"home"]}}];
  [window.nsWindow setContentSize:NSMakeSize(1200, 800)];
  return window;
}

/// What a pane asked of the parent, kept for a check.
static NSMutableArray<NSDictionary *> *heard(NSView<MVAsks> *pane) {
  NSMutableArray<NSDictionary *> *sent = [NSMutableArray array];
  pane.onSend = ^(NSDictionary *message) {
    [sent addObject:message];
  };
  return sent;
}

/// Whether a view stands whole inside another, as a person sees it: nothing cut at an edge.
static BOOL within(NSView *part, NSView *pane) {
  NSRect at = [part convertRect:part.bounds toView:pane];
  return !part.isHiddenOrHasHiddenAncestor && NSContainsRect(NSInsetRect(pane.bounds, -0.5, -0.5), at) && at.size.width > 0;
}

static void checkLogs(MVWindow *window) {
  MVLogPane *pane = window.inspector.logs;
  NSMutableArray<NSDictionary *> *sent = heard(pane);
  [window pokeClick:@"tabLogs"];
  MVPump(0.2);
  MVCheck(@"logs: shown, it asks for the log of the app in front, at Info", [sent.lastObject isEqual:@{@"op": @"paneWatch",
                                                                                                       @"pane": @"logs",
                                                                                                       @"on": @YES,
                                                                                                       @"level": @"info"}],
          sent.description);
  [pane show:@{@"op": @"logs",
               @"reset": @YES,
               @"app": @"Dev App"}];
  [pane show:@{@"op": @"logs",
               @"lines": @[@{@"text": @"I Dev: first"}, @{@"text": @"E Dev: it broke", @"level": @"error"}]}];
  [pane show:@{@"op": @"logs",
               @"lines": @[@{@"text": @"I Dev: third"}]}];
  MVCheck(@"logs: lines come in as they are told, each once", [pane.shownLines isEqual:@[@"I Dev: first", @"E Dev: it broke", @"I Dev: third"]], [pane.shownLines componentsJoinedByString:@"|"]);
  NSTextField *about = [pane valueForKey:@"_about"];
  MVCheck(@"logs: it names the app it follows", [about.stringValue isEqual:MVWord(@"The log of Dev App, as it comes")], about.stringValue);
  NSSearchField *search = [pane valueForKey:@"_search"];
  search.stringValue = @"broke";
  [NSApp sendAction:search.action to:search.target from:search];
  MVCheck(@"logs: a search shows only the lines that hold it", [pane.shownLines isEqual:@[@"E Dev: it broke"]], [pane.shownLines componentsJoinedByString:@"|"]);
  search.stringValue = @"";
  [NSApp sendAction:search.action to:search.target from:search];
  [sent removeAllObjects];
  [window pokeClick:@"logPause"];
  MVPump(0.1);
  [pane show:@{@"op": @"logs",
               @"lines": @[@{@"text": @"I Dev: while paused"}]}];
  MVCheck(@"logs: a pause stops the reads and holds what was on its way", [sent.lastObject[@"on"] isEqual:@NO] && pane.shownLines.count == 3, sent.description);
  [window pokeClick:@"logPause"];
  MVPump(0.1);
  MVCheck(@"logs: and Resume shows it, and reads on", [sent.lastObject[@"on"] isEqual:@YES] && [pane.shownLines.lastObject isEqual:@"I Dev: while paused"], sent.description);
  NSPopUpButton *level = [pane valueForKey:@"_level"];
  [level selectItemAtIndex:4];
  [NSApp sendAction:level.action to:level.target from:level];
  MVCheck(@"logs: another level is asked of the parent", [sent.lastObject[@"level"] isEqual:@"error"], sent.description);
  NSTextView *text = [pane valueForKey:@"_text"];
  NSRange broke = [text.string rangeOfString:@"broke"];
  text.selectedRange = NSMakeRange(broke.location, 2);
  [window pokeClick:@"logCopy"];
  MVPump(0.1);
  MVCheck(@"logs: Copy takes the whole lines a selection touches", [[MVPlaceBoard() stringForType:NSPasteboardTypeString] isEqual:@"E Dev: it broke\n"], [MVPlaceBoard() stringForType:NSPasteboardTypeString]);
  [sent removeAllObjects];
  [window pokeClick:@"logClear"];
  MVPump(0.1);
  MVCheck(@"logs: Clear empties the view and asks nothing of the device", pane.shownLines.count == 0 && sent.count == 0, sent.description);
  [window.nsWindow layoutIfNeeded];
  MVCheck(@"logs: its controls stand whole in the Inspector", within(level, pane) && within([pane valueForKey:@"_copy"], pane) && within(search, pane), nil);
  NSView *pause = MVFindControl(pane, @"logPause"), *clear = MVFindControl(pane, @"logClear");
  NSRect from = [pause convertRect:pause.bounds toView:pane], to = [clear convertRect:clear.bounds toView:pane];
  MVCheck(@"logs: its buttons take the pane's width, edge to edge", NSMinX(from) < 1 && NSMaxX(to) > NSWidth(pane.bounds) - 1, [NSString stringWithFormat:@"%@ to %@ of %.0f", NSStringFromRect(from), NSStringFromRect(to), NSWidth(pane.bounds)]);
  [pane showCrashes:@{@"op": @"crashes",
                      @"reports": @[@{@"at": @"2026-11-09 12:00", @"reason": @"SIGABRT", @"detail": @"0 libsystem abort\n1 Dev main", @"file": @"/tmp/dev.ips"}]}];
  NSButton *crashes = [pane valueForKey:@"_sections"][1];
  [window pokeClick:@"logShowCrashes"];
  MVPump(0.1);
  NSTextView *report = [pane valueForKey:@"_report"];
  MVCheck(@"logs: a crash report opens to its text and where the whole of it is", pane.crashRows.count == 1 && [report.string containsString:@"1 Dev main"] && [report.string containsString:@"/tmp/dev.ips"], report.string);
  MVCheck(@"logs: its section counts the reports, and says it is the one chosen", [crashes.title isEqual:MVWord(@"Crashes: 1")] && [crashes.accessibilityValue isEqual:MVWord(@"selected")], crashes.title);
  [sent removeAllObjects];
  [window pokeClick:@"tabNetwork"];
  MVPump(0.1);
  MVCheck(@"logs: hidden, it stops the reads", [sent.lastObject isEqual:@{@"op": @"paneWatch",
                                                                          @"pane": @"logs",
                                                                          @"on": @NO,
                                                                          @"level": @"error"}],
          sent.description);
}

static void checkNetwork(MVWindow *window) {
  MVNetworkPane *pane = window.inspector.network;
  NSMutableArray<NSDictionary *> *sent = heard(pane);
  [window showPane:MVPaneLogs];
  [window pokeClick:@"tabNetwork"];
  MVPump(0.2);
  MVCheck(@"network: shown, it asks what the device can capture", [sent.lastObject isEqual:@{@"op": @"paneWatch",
                                                                                             @"pane": @"network",
                                                                                             @"on": @YES}],
          sent.description);
  [pane show:@{@"op": @"network",
               @"capturing": @NO,
               @"ways": @[],
               @"needs": @"An iPhone's requests show only through a proxy you run, such as Proxyman, set in the iPhone's Wi-Fi settings, and then they show here. This window changes no setting on a phone."}];
  MVCheck(@"network: where nothing lists requests it says what a person needs, and offers nothing to press", [pane.said containsString:MVWord(@"An iPhone's requests show only through a proxy you run, such as Proxyman, set in the iPhone's Wi-Fi settings, and then they show here. This window changes no setting on a phone.")] && [[pane valueForKey:@"_go"] isHidden], pane.said);
  [window.nsWindow layoutIfNeeded];
  NSView *state = [pane valueForKey:@"_state"], *about = [pane valueForKey:@"_about"];
  double gap = NSMinY([state convertRect:state.bounds toView:nil]) - NSMaxY([about convertRect:about.bounds toView:nil]);
  MVCheck(@"network: what a person needs stands under the state, not at the pane's foot", gap > 0 && gap < 30, [NSString stringWithFormat:@"%.0f", gap]);
  [pane show:@{@"op": @"network",
               @"capturing": @NO,
               @"ways": @[@"probe", @"proxy"],
               @"proxy": @"127.0.0.1:9090"}];
  NSPopUpButton *way = [pane valueForKey:@"_way"];
  MVCheck(@"network: the ways the device has, a proxy by where it is", [way.itemTitles isEqual:@[MVWord(@"Probe"), [MVWord(@"Proxy") stringByAppendingString:@" 127.0.0.1:9090"]]], [way.itemTitles componentsJoinedByString:@"|"]);
  [sent removeAllObjects];
  [window pokeClick:@"networkGo"];
  [window pokeClick:@"networkGo"];
  MVPump(0.1);
  MVCheck(@"network: Start asks for a capture by the way chosen, once until it is answered", sent.count == 1 && [sent[0] isEqual:@{@"op": @"control", @"name": @"networkStart", @"via": @"probe"}], sent.description);
  [pane show:@{@"op": @"answer",
               @"name": @"network",
               @"ok": @YES,
               @"text": @"Capture started"}];
  [pane show:@{@"op": @"network",
               @"capturing": @"probe",
               @"since": @1793000000000,
               @"entries": @[@{@"method": @"GET",
                               @"url": @"https://a.test/x?token=•••",
                               @"status": @200,
                               @"ms": @85,
                               @"bytes": @1200},
                             @{@"method": @"POST",
                               @"url": @"https://a.test/y",
                               @"status": @500,
                               @"ms": @12}]}];
  MVCheck(@"network: each request stands with its method, address, status and time", pane.rows.count == 2 && [pane.rows[0].title isEqual:@"GET a.test/x"] && [pane.rows[0].detail hasPrefix:@"200 · 85 ms · "] && pane.rows[1].tint != nil, [[pane.rows valueForKey:@"title"] componentsJoinedByString:@"|"]);
  MVPokeListRow([pane valueForKey:@"_list"], @"GET a.test/x");
  MVPump(0.1);
  MVCheck(@"network: one chosen shows whole, its address as the op gave it", [pane.detail containsString:@"https://a.test/x?token=•••"], pane.detail);
  MVCheck(@"network: a capture says how and since when, with Stop to end it", [pane.said hasPrefix:@"Capturing by the probe since "] && [[[pane valueForKey:@"_go"] title] isEqual:MVWord(@"Stop")], pane.said);
  [window.nsWindow layoutIfNeeded];
  MVCheck(@"network: its controls stand whole in the Inspector", within([pane valueForKey:@"_go"], pane) && within([pane valueForKey:@"_list"], pane), nil);
  [pane show:@{@"op": @"network",
               @"capturing": @"bytes",
               @"since": @1793000000000,
               @"entries": @[@{@"direction": @"Received",
                               @"host": @"uid 10123",
                               @"bytes": @2048}]}];
  MVCheck(@"network: a count stands as one too, with Read Again where nothing reads it by itself", [pane.rows[0].title isEqual:@"Received · uid 10123"] && ![[pane valueForKey:@"_again"] isHidden], pane.rows[0].title);
}

static void checkAudit(MVWindow *window) {
  MVAuditPane *pane = window.inspector.audit;
  NSMutableArray<NSDictionary *> *sent = heard(pane);
  void (^marks)(NSDictionary *) = pane.onMark;
  NSMutableArray *marked = [NSMutableArray array];
  pane.onMark = ^(NSDictionary *rect) {
    [marked addObject:rect ?: NSNull.null];
    marks(rect);
  };
  [window pokeClick:@"tabAccessibility"];
  MVPump(0.2);
  MVCheck(@"audit: shown, it asks for the screen shown to be audited", [sent.lastObject isEqual:@{@"op": @"paneWatch",
                                                                                                  @"pane": @"accessibility",
                                                                                                  @"on": @YES}],
          sent.description);
  [pane show:@{@"op": @"audit",
               @"state": @"reading",
               @"issues": @[]}];
  MVCheck(@"audit: it says it is reading, and holds Check Again", [pane.said isEqual:MVWord(@"Auditing the screen shown")] && ![[pane valueForKey:@"_again"] isEnabled], pane.said);
  NSDictionary *rect = @{@"x": @0,
                         @"y": @0.1,
                         @"w": @1,
                         @"h": @0.05};
  [pane show:@{@"op": @"audit",
               @"state": @"done",
               @"issues": @[
                 @{@"type": @"hitRegion", @"rule": @"touchTarget", @"message": @"touch target 30×30 dp, under 48×48 dp"},
                 @{@"type": @"contrast", @"rule": @"textContrast", @"message": @"text contrast 2.10:1 (#999999 on #ffffff), under 4.5:1", @"label": @"Send", @"rect": rect},
               ]}];
  NSArray *titles = [pane.rows valueForKey:@"title"];
  MVCheck(@"audit: issues by kind, each kind counted", titles.count == 4 && [titles[0] isEqual:[MVWord(@"Contrast") stringByAppendingString:@" · 1"]] && [titles[2] isEqual:[MVWord(@"Touch target") stringByAppendingString:@" · 1"]] && [pane.said isEqual:MVWord(@"2 issues on this screen")], [titles componentsJoinedByString:@"|"]);
  MVPokeListRow([pane valueForKey:@"_list"], @"text contrast 2.10:1 (#999999 on #ffffff), under 4.5:1");
  MVPump(0.1);
  MVCheck(@"audit: one chosen is marked where it stands on the picture", [marked.lastObject isEqual:rect], [marked description]);
  [sent removeAllObjects];
  [window pokeClick:@"auditAgain"];
  MVPump(0.1);
  MVCheck(@"audit: Check Again asks for it", [sent.lastObject isEqual:@{@"op": @"control", @"name": @"auditAgain"}], sent.description);
  [pane show:@{@"op": @"audit",
               @"state": @"recording",
               @"issues": @[]}];
  MVCheck(@"audit: it says it reads nothing during a recording", [pane.said isEqual:MVWord(@"Not read while recording")], pane.said);
  [window pokeClick:@"tabPerformance"];
  MVPump(0.1);
  MVCheck(@"audit: hidden, it stops and takes its mark away", [sent.lastObject[@"on"] isEqual:@NO] && marked.lastObject == NSNull.null, [marked description]);
}

/// w-iphone: Launch listed the apps again, and the app just launched was no longer chosen, so Quit took a second click on it.
static void checkApps(MVWindow *window) {
  [window showPane:MVPaneApps];
  NSArray *apps = @[@{@"id": @"dev.appdyno.fixture", @"name": @"appdyno fixture"}, @{@"id": @"com.apple.Preferences", @"name": @"Settings"}];
  [window.inspector showApps:@{@"apps": apps}];
  [window.inspector pokeApp:@"dev.appdyno.fixture"];
  MVPump(0.2);
  NSButton *quit = MVFindControl(window.nsWindow.contentView, @"appQuit");
  MVCheck(@"apps: an app chosen by a real click can be quit", quit.enabled, nil);
  [window.inspector showApps:@{@"apps": apps, @"note": @"Launched appdyno fixture"}];
  MVCheck(@"apps: and stays chosen as the list comes again after a launch", quit.enabled, nil);
}

/// The words a list draws in its rows, as a person reads them.
static NSArray<NSString *> *drawn(MVList *list) {
  NSTableView *table = list.documentView;
  [table reloadData];
  NSMutableArray<NSString *> *words = [NSMutableArray array];
  for (NSInteger at = 0; at < table.numberOfRows; at++) {
    NSMutableArray<NSView *> *views = [NSMutableArray arrayWithObject:[table viewAtColumn:0 row:at makeIfNecessary:YES]];
    while (views.count) {
      NSView *view = views.lastObject;
      [views removeLastObject];
      if ([view isKindOfClass:NSTextField.class] && ((NSTextField *)view).stringValue.length) [words addObject:((NSTextField *)view).stringValue];
      [views addObjectsFromArray:view.subviews];
    }
  }
  return words;
}

/// What an app or a device names stands as it came in Turkish too, where the window's own words around it are said.
static void checkContent(MVWindow *window) {
  MVTestTurkish(YES);
  NSArray<NSString *> *names = @[@"Small", @"Settings", @"Continue"];
  NSTextField *field = MVContentText(@"", MVStyleBody);
  NSMutableArray<NSString *> *shown = [NSMutableArray array];
  for (NSString *name in names) {
    field.stringValue = name;
    [shown addObject:field.stringValue];
  }
  BOOL ours = [MVWord(@"Small") isEqual:@"Küçük"] && [MVText(@"Search", MVStyleBody).stringValue isEqual:@"Ara"];
  MVCheck(@"content: a field of the app's shows Small, Settings and Continue as they are in Turkish, where the window's own words are said", [shown isEqual:names] && ours, [shown componentsJoinedByString:@"|"]);
  [window.inspector.audit show:@{@"op": @"audit",
                                 @"state": @"done",
                                 @"issues": @[@{@"type": @"hitRegion", @"rule": @"touchTarget", @"message": @"Hit area is too small", @"label": @"Small"}]}];
  NSArray<NSString *> *issue = drawn([window.inspector.audit valueForKey:@"_list"]);
  MVCheck(@"content: an issue is said in Turkish, and the element it names stands as the app names it", [issue containsObject:@"Dokunma alanı çok küçük"] && [issue containsObject:@"Small"] && ![issue containsObject:@"Küçük"], [issue componentsJoinedByString:@"|"]);
  // the apps' check before chose one by typing its id in the filter
  ((NSSearchField *)[window.inspector valueForKey:@"_filter"]).stringValue = @"";
  [window.inspector showApps:@{@"op": @"apps",
                               @"apps": @[@{@"id": @"com.example.small", @"name": @"Small"}],
                               @"note": @"Launched Small"}];
  NSArray<NSString *> *apps = drawn([window.inspector valueForKey:@"_apps"]);
  NSTextField *note = [window.inspector valueForKey:@"_appsNote"];
  MVCheck(@"content: an app's name stands as it is in the list and in what was done to it", [apps containsObject:@"Small"] && [note.stringValue isEqual:@"Small başlatıldı"], [NSString stringWithFormat:@"%@ / %@", [apps componentsJoinedByString:@"|"], note.stringValue]);
  [window.inspector.flow showElement:@{@"role": @"button", @"label": @"Continue", @"ref": @"@e3", @"tap": @"tap text=\"Settings\""}];
  MVCheck(@"content: the element under the pointer stands as the app names it", [window.inspector.flow.elementShown hasPrefix:@"button Continue | @e3 | tap text=\"Settings\""], window.inspector.flow.elementShown);
  [window addActivity:@{@"at": @0,
                        @"tool": @"tap",
                        @"ok": @YES,
                        @"ms": @3,
                        @"time": @"12:00",
                        @"done": @"Tapped Settings"}];
  NSArray<NSString *> *calls = drawn([window.inspector.activity valueForKey:@"_list"]);
  MVCheck(@"content: what an agent did is said, and what it touched kept", [calls containsObject:@"Settings öğesine dokunuldu"], [calls componentsJoinedByString:@"|"]);
  MVTestTurkish(NO);
}

void MVCheckPanes(void) {
  MVWindow *window = paneWindow(@"panes");
  [window showPane:MVPanePerf];
  MVPump(0.3);
  checkApps(window);
  checkLogs(window);
  checkNetwork(window);
  checkAudit(window);
  checkContent(window);
  [window openInspector:NO];
  MVPump(0.3);
  MVCheck(@"panes: a closed Inspector reads nothing", !window.inspector.logs.watching && !window.inspector.network.watching && !window.inspector.audit.watching, nil);
}
