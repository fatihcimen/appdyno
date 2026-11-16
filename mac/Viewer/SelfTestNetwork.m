// The Network pane in a window kept behind: what it says where nothing is captured, what a capture's row holds, the
// list and what narrows it, what is done to the capture and to one request, and what is left when a capture ends.
#import "Place.h"
#import "SelfTest.h"
#import "WindowParts.h"
#import "Words.h"

static NSDictionary *request(NSInteger number, NSString *method, NSString *url, NSInteger status, NSInteger ms) {
  return @{@"id": @(number),
           @"method": method,
           @"url": url,
           @"status": @(status),
           @"ms": @(ms)};
}

/// What the parent says of a capture by the probe that keeps bodies, with those requests and what else it says.
static NSDictionary *probing(NSArray<NSDictionary *> *entries, NSDictionary *more) {
  NSMutableDictionary *m = [@{@"op": @"network",
                              @"capturing": @"probe",
                              @"since": @1793000000000,
                              @"bodies": @YES,
                              @"entries": entries} mutableCopy];
  [m addEntriesFromDictionary:more];
  return m;
}

/// Whether a part of the pane shows, whole, inside it.
static BOOL stands(NSView *part, NSView *pane) {
  [pane.window layoutIfNeeded];
  NSRect at = [part convertRect:part.bounds toView:pane];
  return !part.isHiddenOrHasHiddenAncestor && at.size.width > 0 && NSContainsRect(NSInsetRect(pane.bounds, -0.5, -0.5), at);
}

/// A picture of the window as it stands, into the folder APPDYNO_NETPANE_LOOK names: a state to be judged by eye, which
/// no check here can do. With no folder named it does nothing.
static void look(MVWindow *window, NSString *name) {
  NSString *folder = NSProcessInfo.processInfo.environment[@"APPDYNO_NETPANE_LOOK"];
  if (!folder.length) return;
  [window.nsWindow layoutIfNeeded];
  MVPump(0.4);
  MVWriteWindow(window.nsWindow, [folder stringByAppendingPathComponent:[name stringByAppendingString:@".png"]]);
}

static NSString *titles(MVNetworkPane *pane) {
  return [[pane.rows valueForKey:@"title"] componentsJoinedByString:@"|"];
}

/// Nothing captured yet: what the device lacks, or the card that starts a capture, with Start in it.
static void checkStart(MVWindow *window, MVNetworkPane *pane, NSMutableArray<NSDictionary *> *sent) {
  NSString *needs = @"An iPhone's requests show only through an HTTP proxy you run, set in the iPhone's Wi-Fi settings, and then they show here. This window changes no setting on a phone.";
  NSButton *go = [pane valueForKey:@"_go"], *bodies = [pane valueForKey:@"_bodies"];
  NSPopUpButton *way = [pane valueForKey:@"_way"];
  NSView *card = [pane valueForKey:@"_card"], *row = [pane valueForKey:@"_captureRow"];
  [pane show:@{@"op": @"network",
               @"capturing": @NO,
               @"ways": @[],
               @"needs": needs}];
  MVCheck(@"network: where nothing lists requests a card says what a person needs, and offers nothing to press", [pane.said containsString:MVWord(needs)] && stands(card, pane) && go.isHiddenOrHasHiddenAncestor && row.hidden, pane.said);
  [pane show:@{@"op": @"network",
               @"capturing": @NO,
               @"ways": @[@"probe", @"proxy"],
               @"proxy": @"127.0.0.1:9090"}];
  MVCheck(@"network: the ways the device has, a proxy by where it is, to choose from where it has more than one", [way.itemTitles isEqual:@[MVWord(@"Probe"), [MVWord(@"Proxy") stringByAppendingString:@" 127.0.0.1:9090"]]] && stands(way, card), [way.itemTitles componentsJoinedByString:@"|"]);
  [pane show:@{@"op": @"network",
               @"capturing": @NO,
               @"ways": @[@"probe"]}];
  MVCheck(@"empty: the card says what the probe does, that the app restarts, and holds Start", [pane.said containsString:MVWord(@"See this app's requests")] && [pane.said containsString:@"Restarts the app"] && stands(go, card) && [go.title isEqual:MVWord(@"Start")] && row.hidden && way.isHiddenOrHasHiddenAncestor, pane.said);
  look(window, @"empty");
  MVCheck(@"empty: headers and bodies are kept unless a person says not", stands(bodies, card) && bodies.state == NSControlStateValueOn, nil);
  [sent removeAllObjects];
  [window pokeClick:@"networkGo"];
  [window pokeClick:@"networkGo"];
  MVPump(0.1);
  NSDictionary *start = @{@"op": @"control",
                          @"name": @"networkStart",
                          @"via": @"probe",
                          @"bodies": @YES};
  MVCheck(@"empty: Start asks for a capture by the way chosen, with bodies, once until it is answered", sent.count == 1 && [sent[0] isEqual:start], sent.description);
  [pane show:@{@"op": @"answer",
               @"name": @"network",
               @"ok": @NO,
               @"text": @"Open an app of yours to capture its requests"}];
  MVCheck(@"error: what the parent refused stands at the pane's foot, and stays", [pane.answer.said isEqual:MVWord(@"Open an app of yours to capture its requests")] && stands(pane.answer, pane) && NSMinY([pane.answer convertRect:pane.answer.bounds toView:pane]) < NSMinY([card convertRect:card.bounds toView:pane]), pane.answer.said);
  bodies.state = NSControlStateValueOff;
  [sent removeAllObjects];
  [window pokeClick:@"networkGo"];
  MVPump(0.1);
  MVCheck(@"empty: with bodies off it asks for none", [sent.firstObject isEqual:@{@"op": @"control", @"name": @"networkStart", @"via": @"probe"}], sent.description);
  bodies.state = NSControlStateValueOn;
  [pane show:@{@"op": @"answer",
               @"name": @"network",
               @"ok": @YES,
               @"text": @"Capture started"}];
}

/// A capture that runs: its row, the card while nothing has come, the sections and the speed.
static void checkCapture(MVWindow *window, MVNetworkPane *pane, NSMutableArray<NSDictionary *> *sent) {
  NSButton *go = [pane valueForKey:@"_go"];
  NSView *card = [pane valueForKey:@"_card"], *row = [pane valueForKey:@"_captureRow"], *tortoise = [pane valueForKey:@"_tortoise"];
  NSTextField *state = [pane valueForKey:@"_state"];
  NSPopUpButton *speed = [pane valueForKey:@"_throttle"];
  [pane show:probing(@[], @{@"throttle": @"full",
                            @"rules": @[],
                            @"unseen": @{@"webview": @2, @"websocket": @1}})];
  MVCheck(@"listening: with no request yet the card says it listens, and what the app made that it cannot see", [pane.said containsString:MVWord(@"Listening")] && [pane.said hasSuffix:@"Not seen here: web views: 2, WebSocket tasks: 1"] && stands(card, pane), pane.said);
  look(window, @"listening");
  MVCheck(@"capture: its row holds Stop, the time gone and how many requests, and says since when to a screen reader", stands(go, row) && [go.title isEqual:MVWord(@"Stop")] && [state.stringValue hasSuffix:@" · 0 requests"] && [state.accessibilityLabel hasPrefix:@"Capturing by the probe since "], [NSString stringWithFormat:@"%@ | %@", state.stringValue, state.accessibilityLabel]);
  MVCheck(@"capture: the speed stands in its row, named, with no mark while the network is as it is", stands(speed, row) && [speed.titleOfSelectedItem isEqual:MVWord(@"Full Speed")] && tortoise.hidden && [speed.accessibilityLabel isEqual:MVWord(@"Network speed")], speed.titleOfSelectedItem);
  [pane show:probing(@[], @{@"throttle": @"edge"})];
  MVCheck(@"capture: a speed set stands chosen, with the mark of a slowed network beside it", [speed.titleOfSelectedItem isEqual:@"EDGE"] && stands(tortoise, row), speed.titleOfSelectedItem);
  [pane show:probing(@[], @{@"throttle": @"delayMs=300 loss=5"})];
  MVCheck(@"capture: a speed an agent set in its own words stands as a person reads it", [speed.titleOfSelectedItem isEqual:@"300 ms, 5 % lost"] && [speed.selectedItem.toolTip isEqual:@"delayMs=300 loss=5"], speed.titleOfSelectedItem);
  [sent removeAllObjects];
  [speed selectItemAtIndex:1];
  [speed sendAction:speed.action to:speed.target];
  NSDictionary *slowed = @{@"op": @"control", @"name": @"networkThrottle", @"value": @"slow"};
  MVCheck(@"capture: a speed chosen is asked for by the op's word", [sent.lastObject isEqual:slowed], [sent.lastObject description]);
  [pane show:probing(@[], @{@"throttle": @"full",
                            @"elsewhere": @YES})];
  MVCheck(@"capture: what an agent changed is said once at the pane's foot", [pane.answer.said isEqual:MVWord(@"The rules or the speed were changed elsewhere")], pane.answer.said);
  [sent removeAllObjects];
  [window pokeClick:@"networkGo"];
  MVPump(0.1);
  MVCheck(@"capture: Stop asks to end it", [sent.firstObject isEqual:@{@"op": @"control", @"name": @"networkStop"}], sent.description);
  [pane show:@{@"op": @"answer",
               @"name": @"network",
               @"ok": @NO,
               @"text": @"Not stopped"}];
}

/// The requests: under their hosts, counted, narrowed by words in either language and by the scope of what failed.
static void checkList(MVWindow *window, MVNetworkPane *pane, NSMutableArray<NSDictionary *> *sent) {
  MVList *list = [pane valueForKey:@"_list"];
  MVFilterField *filter = pane.filter;
  NSButton *failed = MVFindControl(pane, @"networkFailed");
  NSArray<NSDictionary *> *two = @[@{@"id": @7,
                                     @"method": @"GET",
                                     @"url": @"https://a.test/x?token=•••",
                                     @"status": @200,
                                     @"ms": @3,
                                     @"bytes": @1200,
                                     @"how": @"mocked"},
                                   request(8, @"POST", @"https://b.test/pay", 500, 9)];
  [pane show:probing(two, @{})];
  MVCheck(@"requests: each stands under its host, by its method and path, the card gone", [[list.rows valueForKey:@"title"] isEqual:(@[@"a.test", @"GET /x", @"b.test", @"POST /pay"])] && [[pane valueForKey:@"_card"] isHidden] && stands(list, pane) && stands(filter, pane), [[list.rows valueForKey:@"title"] componentsJoinedByString:@"|"]);
  MVCheck(@"requests: one a rule answered says so, and one the server refused is marked", [pane.rows[0].detail containsString:MVWord(@"Mocked")] && pane.rows[1].tint != nil && !pane.note.length, pane.rows[0].detail);
  [pane show:probing([two arrayByAddingObject:@{@"id": @9,
                                                @"method": @"GET",
                                                @"url": @"https://a.test/feed",
                                                @"ms": @41000,
                                                @"inFlight": @YES}],
                     @{@"total": @1234})];
  look(window, @"list");
  MVCheck(@"requests: one still under way stands with its host's, and says for how long", [titles(pane) isEqual:@"GET /x|GET /feed|POST /pay"] && [pane.rows[1].detail isEqual:MVFormat(@"In flight for %@", @[@"41 s"])] && [pane.rows[1].symbol isEqual:@"hourglass"], [[pane.rows valueForKey:@"detail"] componentsJoinedByString:@"|"]);
  NSTextField *state = [pane valueForKey:@"_state"];
  MVCheck(@"requests: a list that is the latest of more says how many it shows of how many, and the capture's row how many there are", [pane.note isEqual:@"Showing the latest 2 of 1,234 requests"] && [state.stringValue hasSuffix:@" · 1,234 requests"], [NSString stringWithFormat:@"%@ | %@", pane.note, state.stringValue]);
  MVTestTurkish(YES);
  [pane show:probing(two, @{@"total": @1234})];
  MVCheck(@"requests: and in Turkish, its thousands set apart as Turkish sets them", [pane.note isEqual:@"1.234 isteğin son 2 tanesi gösteriliyor"] && [state.stringValue hasSuffix:@" · 1.234 istek"], [NSString stringWithFormat:@"%@ | %@", pane.note, state.stringValue]);
  // the op's words for how a request stands find it in either language, however they are typed
  NSString * (^found)(NSString *) = ^(NSString *typed) {
    filter.words = typed;
    return titles(pane);
  };
  NSString *turkish = [@[found(@"başarısız"), found(@"BAŞARISIZ"), found(@"basarisiz"), found(@"failed"), found(@"FAILED"), found(@"5xx")] componentsJoinedByString:@" "];
  NSString *mocked = [@[found(@"sahte"), found(@"SAHTE"), found(@"mocked"), found(@"2xx get")] componentsJoinedByString:@" "];
  MVTestTurkish(NO);
  [pane show:probing(two, @{})];
  NSString *english = [@[found(@"failed"), found(@"Failed"), found(@"başarısız"), found(@"mocked"), found(@"post 500")] componentsJoinedByString:@" "];
  MVCheck(@"requests: `failed` and `başarısız` find what failed in a Turkish window and an English one, in capitals and without the marks", [turkish isEqual:@"POST /pay POST /pay POST /pay POST /pay POST /pay POST /pay"] && [mocked isEqual:@"GET /x GET /x GET /x GET /x"] && [english isEqual:@"POST /pay POST /pay POST /pay GET /x POST /pay"], [NSString stringWithFormat:@"%@ ; %@ ; %@", turkish, mocked, english]);
  filter.words = @"nothing-has-this";
  MVCheck(@"requests: words that leave nothing say so, and the filter stays to be changed", !pane.rows.count && [pane.note isEqual:MVWord(@"No request here matches the filter.")] && stands(filter, pane), pane.note);
  filter.words = @"";
  MVCheck(@"requests: what failed is counted beside the filter, one a rule answered not among it", stands(failed, pane) && [failed.accessibilityLabel hasSuffix:@", 1"] && [failed.accessibilityValue isEqual:@NO], failed.accessibilityLabel);
  [window pokeClick:@"networkFailed"];
  MVPump(0.1);
  MVCheck(@"requests: its scope leaves only what failed, and says it is on", [titles(pane) isEqual:@"POST /pay"] && [failed.accessibilityValue isEqual:@YES], titles(pane));
  [window pokeClick:@"networkFailed"];
  MVPump(0.1);
  MVSegments *sections = [pane valueForKey:@"_sections"];
  NSButton *requests = MVFindControl(sections, @"networkShowRequests");
  MVCheck(@"requests: the sections stand as one choice of two, the one chosen said, with how many it holds", stands(sections, pane) && sections.chosen == 0 && [requests.accessibilityLabel isEqual:[NSString stringWithFormat:@"%@, 2", MVWord(@"Requests")]] && [requests.accessibilityValue isEqual:@YES] && [requests.accessibilityRole isEqual:NSAccessibilityRadioButtonRole], requests.accessibilityLabel);
  [sent removeAllObjects];
}

/// One request chosen, and what is done to it and to the capture.
static void checkRequest(MVWindow *window, MVNetworkPane *pane, NSMutableArray<NSDictionary *> *sent) {
  MVList *list = [pane valueForKey:@"_list"];
  MVPokeListRow(list, @"GET /x");
  MVPump(0.1);
  NSDictionary *asked = @{@"op": @"control",
                          @"name": @"networkDetail",
                          @"id": @7};
  [pane show:probing(@[@{@"id": @7,
                         @"method": @"GET",
                         @"url": @"https://a.test/x?token=•••",
                         @"status": @200,
                         @"ms": @3,
                         @"how": @"mocked"},
                       request(8, @"POST", @"https://b.test/pay", 500, 9)],
                     @{})];
  MVCheck(@"request: one chosen asks for its headers and bodies, once however often the list is read again", sent.count == 1 && [sent[0] isEqual:asked], sent.description);
  MVCheck(@"request: and shows whole meanwhile, its address as the op gave it", [pane.detail containsString:@"https://a.test/x?token=•••"], pane.detail);
  NSDictionary *parts = @{@"id": @7,
                          @"lines": @[@"7 GET https://a.test/x 200", @"request headers:"],
                          @"request": @{@"method": @"GET", @"url": @"https://a.test/x", @"status": @200, @"ms": @3, @"how": @"mocked"},
                          @"timings": @{@"dns": @1, @"connect": @2, @"tls": @-1, @"wait": @5, @"receive": @1250, @"reused": @NO, @"proto": @"http/1.1", @"wire": @39},
                          @"kept": @YES,
                          @"requestHeaders": @[@{@"name": @"Authorization", @"value": @"•••"}],
                          @"responseHeaders": @[@{@"name": @"Content-Type", @"value": @"application/json"}],
                          @"responseBody": @"{\"error\":\"down\"}",
                          @"responseBodySize": @16};
  [pane show:@{@"op": @"network", @"detail": parts}];
  NSString *inEnglish = pane.detail;
  MVTestTurkish(YES);
  [pane show:@{@"op": @"network", @"detail": parts}];
  NSString *inTurkish = pane.detail;
  NSMutableDictionary *bare = [parts mutableCopy];
  bare[@"kept"] = @NO;
  [pane show:@{@"op": @"network", @"detail": bare}];
  NSString *notKept = pane.detail;
  MVTestTurkish(NO);
  NSArray<NSString *> *wantEnglish = @[@"#7 GET https://a.test/x", @"DNS 1 ms · Connect 2 ms · Wait 5 ms · Receive 1.25 s", @"http/1.1 · New connection · 39 B on the wire", @"Request headers\n  Authorization: •••", @"Response headers\n  Content-Type: application/json", @"Response body (16 B)\n{\"error\":\"down\"}"];
  NSArray<NSString *> *wantTurkish = @[@"#7 GET https://a.test/x", @"DNS 1 ms · Bağlantı 2 ms · Bekleme 5 ms · Alma 1,25 s", @"http/1.1 · Yeni bağlantı · hatta 39 B", @"İstek başlıkları\n  Authorization: •••", @"Yanıt başlıkları\n  Content-Type: application/json", @"Yanıt gövdesi (16 B)\n{\"error\":\"down\"}", @"Sahte yanıt"];
  NSString * (^lacks)(NSString *, NSArray<NSString *> *) = ^(NSString *text, NSArray<NSString *> *all) {
    NSMutableArray<NSString *> *missing = [NSMutableArray array];
    for (NSString *one in all)
      if (![text containsString:one]) [missing addObject:one];
    return [missing componentsJoinedByString:@" | "];
  };
  look(window, @"request");
  MVCheck(@"detail: a request's parts stand under names of the window's own, what was sent as it was sent", !lacks(inEnglish, wantEnglish).length, [NSString stringWithFormat:@"%@ in %@", lacks(inEnglish, wantEnglish), inEnglish]);
  MVCheck(@"detail: and in Turkish every name is Turkish, with nothing of the op's English left", !lacks(inTurkish, wantTurkish).length && ![inTurkish containsString:@"request headers"] && ![inTurkish containsString:@"connection"] && ![inTurkish containsString:@"mocked"], [NSString stringWithFormat:@"%@ in %@", lacks(inTurkish, wantTurkish), inTurkish]);
  MVCheck(@"detail: one whose headers and bodies were not kept says so and what to do, in Turkish too", [notKept hasSuffix:@"Başlıkları ve gövdeleri tutulmadı. Okumak için onları tutan bir yakalama başlatın."], notKept);
  [sent removeAllObjects];
  [window pokeClick:@"networkCurl"];
  MVPump(0.1);
  NSDictionary *curl = @{@"op": @"control",
                         @"name": @"networkCurl",
                         @"id": @7};
  MVCheck(@"request: Copy as cURL asks for the request chosen, hidden as an answer is", [sent.lastObject isEqual:curl], [sent.lastObject description]);
  [pane show:@{@"op": @"network", @"curl": @"curl -X GET 'https://a.test/x'"}];
  MVCheck(@"request: and copies what the parent gives", [[MVPlaceBoard() stringForType:NSPasteboardTypeString] isEqual:@"curl -X GET 'https://a.test/x'"], [MVPlaceBoard() stringForType:NSPasteboardTypeString]);
  MVCheck(@"capture: real values are not shown until a person asks", !pane.real, nil);
  [sent removeAllObjects];
  [pane choose:@"networkReal"];
  NSDictionary *whole = @{@"op": @"control",
                          @"name": @"networkDetail",
                          @"id": @7,
                          @"real": @YES};
  NSButton *more = [pane valueForKey:@"_more"];
  MVCheck(@"capture: asked for, the request chosen is asked for again as it was sent, and the pane's button says they show", pane.real && [sent.lastObject isEqual:whole] && [more.toolTip isEqual:MVWord(@"More. Real values show in this window.")], [sent.lastObject description]);
  [window pokeClick:@"networkCurl"];
  MVPump(0.1);
  MVCheck(@"request: and so is its command", [sent.lastObject[@"real"] isEqual:@YES] && [sent.lastObject[@"name"] isEqual:@"networkCurl"], [sent.lastObject description]);
  [pane choose:@"networkReal"];
  [pane choose:@"networkSave"];
  NSDictionary *save = @{@"op": @"control", @"name": @"networkSave"};
  MVCheck(@"capture: Save HAR and Clear List are the parent's to do, each by its name", [sent.lastObject isEqual:save] && !pane.real, [sent.lastObject description]);
  [window pokeClick:@"networkMockFrom"];
  MVPump(0.1);
  NSDictionary *mock = @{@"op": @"control",
                         @"name": @"networkMockFrom",
                         @"id": @7};
  MVCheck(@"request: Mock This Answer asks for a rule of the request chosen", [sent.lastObject isEqual:mock], [sent.lastObject description]);
  [pane show:@{@"op": @"network",
               @"rule": @"\"a.test/x\" status=200 body=ok",
               @"fields": @{@"host": @"a.test", @"path": @"/x", @"status": @"200", @"body": @"ok"}}];
  MVCheck(@"request: and the rule stands in the rules' field and in its fields, to be set or changed", !pane.rules.hidden && [[[pane.rules valueForKey:@"_field"] stringValue] isEqual:@"\"a.test/x\" status=200 body=ok"] && [pane.rules.form.fields isEqual:(@{@"host": @"a.test", @"path": @"/x", @"status": @"200", @"body": @"ok"})], pane.rules.form.fields.description);
  [window pokeClick:@"networkShowRequests"];
  MVPump(0.1);
  [[pane.rules valueForKey:@"_field"] setStringValue:@""];
  MVCheck(@"capture: the requests stand first, and the rules in their place when asked for", pane.rules.hidden && !list.hidden, nil);
  // a probe's requests are read again every 3 s; past the most a read holds, the oldest go and every place moves
  MVPokeListRow(list, @"POST /pay");
  MVPump(0.1);
  NSTextView *detail = [pane valueForKey:@"_detail"];
  detail.selectedRange = NSMakeRange(0, 4);
  [pane show:probing(@[request(8, @"POST", @"https://b.test/pay", 500, 9), request(9, @"GET", @"https://a.test/z", 200, 9)], @{})];
  MVCheck(@"request: the one chosen stays open as requests come and go, and so does what was selected in it", [pane.detail hasPrefix:@"POST https://b.test/pay"] && NSEqualRanges(detail.selectedRange, NSMakeRange(0, 4)), [NSString stringWithFormat:@"%@ %@", pane.detail, NSStringFromRange(detail.selectedRange)]);
}

/// A capture that ended: its list and the filter stay, and what needs a capture that runs is off, with why.
static void checkStopped(MVWindow *window, MVNetworkPane *pane, NSMutableArray<NSDictionary *> *sent) {
  NSArray<NSDictionary *> *left = @[request(7, @"GET", @"https://a.test/x", 200, 3), request(8, @"POST", @"https://b.test/pay", 500, 9)];
  NSButton *go = [pane valueForKey:@"_go"], *more = [pane valueForKey:@"_more"], *curl = [pane valueForKey:@"_curl"];
  NSTextField *state = [pane valueForKey:@"_state"];
  [pane show:probing(left, @{})];
  [pane show:@{@"op": @"network",
               @"capturing": @NO,
               @"was": @"probe",
               @"ways": @[@"probe"],
               @"entries": left,
               @"total": @2}];
  MVCheck(@"stopped: the requests stay with the words that narrow them, and the row says when it stopped and offers Start", pane.rows.count == 2 && stands(pane.filter, pane) && [state.stringValue hasPrefix:MVFormat(@"Stopped at %@", @[@""])] && [state.stringValue hasSuffix:@" · 2 requests"] && [go.title isEqual:MVWord(@"Start")] && stands(go, [pane valueForKey:@"_captureRow"]), state.stringValue);
  pane.filter.words = @"pay";
  MVCheck(@"stopped: and those words still narrow the list", [titles(pane) isEqual:@"POST /pay"], titles(pane));
  MVPokeListRow([pane valueForKey:@"_list"], @"POST /pay");
  MVPump(0.1);
  [sent removeAllObjects];
  [pane choose:@"networkSave"];
  [pane choose:@"networkReal"];
  MVCheck(@"stopped: what reads the capture is off, asks for nothing, and the pane says why", curl.isHiddenOrHasHiddenAncestor && !more.enabled && sent.count == 0 && !pane.real && [pane.note hasPrefix:MVWord(@"The capture has ended.")] && [more.toolTip isEqual:pane.note] && [pane.detail hasPrefix:@"POST https://b.test/pay"], [NSString stringWithFormat:@"%@ | %@", sent, pane.note]);
  look(window, @"stopped");
  pane.filter.words = @"";
  [pane show:probing(left, @{})];
  MVCheck(@"stopped: a capture that runs again has them back", more.enabled && !pane.note.length && stands(curl, pane), pane.note);
  [pane show:@{@"op": @"network",
               @"capturing": @"bytes",
               @"since": @1793000000000,
               @"entries": @[@{@"direction": @"Received",
                               @"host": @"uid 10123",
                               @"bytes": @2048}]}];
  MVCheck(@"network: a count stands as a row too, with Read Again where nothing reads it by itself, and no speed or sections", [pane.rows[0].title isEqual:@"Received · uid 10123"] && stands([pane valueForKey:@"_again"], pane) && [[pane valueForKey:@"_throttle"] isHidden] && [[pane valueForKey:@"_sections"] isHidden], pane.rows[0].title);
}

void MVCheckNetwork(MVWindow *window, MVNetworkPane *pane, NSMutableArray<NSDictionary *> *sent) {
  checkStart(window, pane, sent);
  checkCapture(window, pane, sent);
  checkList(window, pane, sent);
  checkRequest(window, pane, sent);
  MVCheckNetworkRules(window, pane, sent);
  [window pokeClick:@"networkShowRequests"];
  MVPump(0.1);
  checkStopped(window, pane, sent);
}
