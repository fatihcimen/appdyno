// The Network pane's part that only the probe has, in a window kept behind: what it sends for a person's choices,
// and what it shows of the parent's answers.
#import "Place.h"
#import "SelfTest.h"
#import "WindowParts.h"
#import "Words.h"

/// A rule by its fields: shown when asked for, filled from the rule chosen, and sent as fields for the parent to write
/// as a line; and what the capture holds beside its rules, each set by its own switch.
static void MVCheckRuleFields(MVWindow *window, MVNetworkPane *pane, NSMutableArray<NSDictionary *> *sent) {
  MVNetworkRuleForm *form = pane.rules.form;
  MVCheck(@"rules: the fields stay out of the way until asked for", form.hidden, nil);
  [window pokeClick:@"networkRuleFields"];
  MVPump(0.1);
  [pane show:@{@"op": @"network",
               @"capturing": @"probe",
               @"strict": @YES,
               @"unmatched": @"fail",
               @"rules": @[@{@"rule": @"\"a.test/x\" method=POST status=503",
                             @"id": @"cc3333",
                             @"hits": @2,
                             @"fields": @{@"method": @"POST", @"host": @"a.test", @"path": @"/x", @"status": @"503"}}],
               @"entries": @[]}];
  MVPokeListRow([pane.rules valueForKey:@"_list"], @"\"a.test/x\" method=POST status=503");
  MVPump(0.1);
  NSPopUpButton *method = [form valueForKey:@"_method"];
  [window.nsWindow layoutIfNeeded];
  NSRect place = [form convertRect:form.bounds toView:pane];
  MVCheck(@"rules: asked for, they stand whole in the Inspector with the rule chosen in them", !form.hidden && NSContainsRect(pane.bounds, place) && [method.titleOfSelectedItem isEqual:@"POST"] && [form.fields isEqual:(@{@"method": @"POST", @"host": @"a.test", @"path": @"/x", @"status": @"503"})], [NSString stringWithFormat:@"%@ in %@ %@", NSStringFromRect(place), NSStringFromRect(pane.bounds), form.fields]);
  NSTextField *status = [form valueForKey:@"_texts"][@"status"];
  status.stringValue = @"404";
  form.onEdit();
  [sent removeAllObjects];
  [window pokeClick:@"networkRuleSave"];
  MVPump(0.1);
  NSDictionary *fields = @{@"op": @"control",
                           @"name": @"networkRuleSave",
                           @"id": @"cc3333",
                           @"fields": @{@"method": @"POST", @"host": @"a.test", @"path": @"/x", @"status": @"404"}};
  MVCheck(@"rules: changed in its fields, the rule is sent as fields, by its name", [sent.lastObject isEqual:fields], [sent.lastObject description]);
  NSButton *strict = [pane.rules valueForKey:@"_strict"], *unmatched = [pane.rules valueForKey:@"_unmatched"];
  MVCheck(@"rules: what the capture holds beside them stands as an agent set it", strict.state == NSControlStateValueOn && unmatched.state == NSControlStateValueOn, nil);
  unmatched.state = NSControlStateValueOff;
  [unmatched sendAction:unmatched.action to:unmatched.target];
  NSDictionary *passes = @{@"op": @"control", @"name": @"networkKeep", @"unmatched": @"pass"};
  MVCheck(@"rules: and each is set by its own switch, by the op's word", [sent.lastObject isEqual:passes], [sent.lastObject description]);
  [window pokeClick:@"networkRuleFields"];
  MVPump(0.1);
}

/// What only the probe has: headers and bodies asked for at its start, and rules and a speed while it runs.
void MVCheckProbe(MVWindow *window, MVNetworkPane *pane, NSMutableArray<NSDictionary *> *sent) {
  [pane show:@{@"op": @"network",
               @"capturing": @NO,
               @"ways": @[@"probe"]}];
  NSButton *bodies = [pane valueForKey:@"_bodies"];
  NSPopUpButton *speed = [pane valueForKey:@"_throttle"];
  MVCheck(@"probe: it offers to keep headers and bodies, and its rules and speed only while it runs", !bodies.hidden && speed.hidden && pane.rules.hidden, nil);
  bodies.state = NSControlStateValueOn;
  [window.nsWindow layoutIfNeeded];
  MVPump(0.1);
  [sent removeAllObjects];
  [window pokeClick:@"networkGo"];
  MVPump(0.1);
  MVCheck(@"probe: Start asks for bodies where they are wanted", [sent.firstObject isEqual:@{@"op": @"control",
                                                                                             @"name": @"networkStart",
                                                                                             @"via": @"probe",
                                                                                             @"bodies": @YES}],
          sent.description);
  [pane show:@{@"op": @"answer",
               @"name": @"network",
               @"ok": @YES,
               @"text": @"Capture started"}];
  NSString *first = @"\"a.test/x\" status=503", *second = @"\"a.test/y\" fail=offline off";
  [pane show:@{@"op": @"network",
               @"capturing": @"probe",
               @"since": @1793000000000,
               @"bodies": @YES,
               @"throttle": @"edge",
               @"rules": @[@{@"rule": first,
                             @"id": @"aa1111",
                             @"hits": @2},
                           @{@"rule": second,
                             @"id": @"bb2222",
                             @"hits": @0,
                             @"off": @YES}],
               @"entries": @[@{@"id": @7,
                               @"method": @"GET",
                               @"url": @"https://a.test/x",
                               @"status": @200,
                               @"ms": @3,
                               @"how": @"mocked"}]}];
  MVCheck(@"probe: a request a rule answered says so, the speed set stands chosen, and each rule stands with what it took", [pane.rows[0].detail containsString:MVWord(@"Mocked")] && [speed.titleOfSelectedItem isEqual:@"EDGE"] && pane.rules.rows.count == 2 && [pane.rules.rows[1].detail hasPrefix:MVWord(@"Off")], [NSString stringWithFormat:@"%@ | %@ | %@", pane.rows[0].detail, speed.titleOfSelectedItem, [[pane.rules.rows valueForKey:@"detail"] componentsJoinedByString:@"|"]]);
  [sent removeAllObjects];
  MVPokeListRow([pane valueForKey:@"_list"], @"GET /x");
  MVPump(0.1);
  [pane show:@{@"op": @"network",
               @"capturing": @"probe",
               @"bodies": @YES,
               @"entries": @[@{@"id": @7,
                               @"method": @"GET",
                               @"url": @"https://a.test/x",
                               @"status": @200,
                               @"ms": @3,
                               @"how": @"mocked"}]}];
  MVCheck(@"probe: a request chosen asks for its headers and bodies, once however often it is read again", sent.count == 1 && [sent[0] isEqual:@{@"op": @"control",
                                                                                                                                                 @"name": @"networkDetail",
                                                                                                                                                 @"id": @7}],
          sent.description);
  [pane show:@{@"op": @"network",
               @"detail": @{@"id": @7, @"lines": @[@"7 GET https://a.test/x 200", @"response body (16 B):", @"{\"error\":\"down\"}"]}}];
  MVCheck(@"probe: and shows them whole, the list as it was", [pane.detail hasSuffix:@"{\"error\":\"down\"}"] && pane.rows.count == 1, pane.detail);
  MVNetworkActions *actions = pane.actions;
  NSTextField *filter = [actions valueForKey:@"_field"];
  NSDictionary *again = @{@"op": @"network",
                          @"capturing": @"probe",
                          @"bodies": @YES,
                          @"entries": @[@{@"id": @7,
                                          @"method": @"GET",
                                          @"url": @"https://a.test/x",
                                          @"status": @200,
                                          @"ms": @3,
                                          @"how": @"mocked"},
                                        @{@"id": @8,
                                          @"method": @"POST",
                                          @"url": @"https://b.test/pay",
                                          @"status": @500,
                                          @"ms": @9}]};
  [pane show:again];
  MVList *list = [pane valueForKey:@"_list"];
  NSArray<NSString *> * (^hosts)(void) = ^{
    return [[list.rows filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"header == YES"]] valueForKey:@"title"];
  };
  MVCheck(@"requests: each stands under its host, by its method and path", [hosts() isEqual:(@[@"a.test", @"b.test"])] && [[list.rows valueForKey:@"title"] isEqual:(@[@"a.test", @"GET /x", @"b.test", @"POST /pay"])], [[list.rows valueForKey:@"title"] componentsJoinedByString:@"|"]);
  NSMutableDictionary *flying = [again mutableCopy];
  flying[@"entries"] = [again[@"entries"] arrayByAddingObject:@{@"id": @9,
                                                                @"method": @"GET",
                                                                @"url": @"https://a.test/feed",
                                                                @"ms": @41000,
                                                                @"inFlight": @YES}];
  flying[@"unseen"] = @{@"webview": @2,
                        @"websocket": @1};
  [pane show:flying];
  MVCheck(@"requests: one still under way stands with its host's, and says for how long", [[list.rows valueForKey:@"title"] isEqual:(@[@"a.test", @"GET /x", @"GET /feed", @"b.test", @"POST /pay"])] && [pane.rows[1].detail isEqual:MVFormat(@"In flight for %@", @[@"41 s"])] && [pane.rows[1].symbol isEqual:@"hourglass"], [[pane.rows valueForKey:@"detail"] componentsJoinedByString:@"|"]);
  MVCheck(@"probe: what the app made that it cannot see is said, each kind counted", [pane.said hasSuffix:@"Not seen here: web views: 2, WebSocket tasks: 1"], pane.said);
  [pane show:again];
  filter.stringValue = @"post 500";
  actions.onChange();
  MVCheck(@"requests: words in the filter leave the rows that hold them all, in any case", pane.rows.count == 1 && [pane.rows[0].title isEqual:@"POST /pay"] && [hosts() isEqual:@[@"b.test"]], [[pane.rows valueForKey:@"title"] componentsJoinedByString:@"|"]);
  filter.stringValue = @"";
  actions.onChange();
  MVPokeListRow([pane valueForKey:@"_list"], @"GET /x");
  MVPump(0.1);
  [sent removeAllObjects];
  [window pokeClick:@"networkCurl"];
  MVPump(0.1);
  NSDictionary *asked = @{@"op": @"control",
                          @"name": @"networkCurl",
                          @"id": @7};
  MVCheck(@"requests: Copy as cURL asks for the request chosen, hidden as an answer is", [sent.lastObject isEqual:asked], [sent.lastObject description]);
  [pane show:@{@"op": @"network", @"curl": @"curl -X GET 'https://a.test/x'"}];
  MVCheck(@"requests: and copies what the parent gives", [[MVPlaceBoard() stringForType:NSPasteboardTypeString] isEqual:@"curl -X GET 'https://a.test/x'"], [MVPlaceBoard() stringForType:NSPasteboardTypeString]);
  NSButton *real = [actions valueForKey:@"_real"];
  MVCheck(@"requests: real values are not shown until a person asks", real.state == NSControlStateValueOff && !actions.real, nil);
  [window.nsWindow layoutIfNeeded];
  NSRect place = [real convertRect:real.bounds toView:pane];
  MVCheck(@"requests: its tools stand whole in the Inspector", NSContainsRect(pane.bounds, place) && NSContainsRect(pane.bounds, [filter convertRect:filter.bounds toView:pane]), NSStringFromRect(place));
  [sent removeAllObjects];
  real.state = NSControlStateValueOn;
  [real sendAction:real.action to:real.target];
  NSDictionary *whole = @{@"op": @"control",
                          @"name": @"networkDetail",
                          @"id": @7,
                          @"real": @YES};
  MVCheck(@"requests: asked for, the request chosen is asked for again as it was sent", actions.real && [sent.lastObject isEqual:whole], [sent.lastObject description]);
  [window pokeClick:@"networkCurl"];
  MVPump(0.1);
  MVCheck(@"requests: and so is its command", [sent.lastObject[@"real"] isEqual:@YES] && [sent.lastObject[@"name"] isEqual:@"networkCurl"], [sent.lastObject description]);
  real.state = NSControlStateValueOff;
  [real sendAction:real.action to:real.target];
  [window pokeClick:@"networkSave"];
  MVPump(0.1);
  NSDictionary *save = @{@"op": @"control", @"name": @"networkSave"};
  MVCheck(@"requests: Save HAR and Clear are the parent's to do", [sent.lastObject isEqual:save], [sent.lastObject description]);
  [window pokeClick:@"networkMockFrom"];
  MVPump(0.1);
  NSDictionary *mock = @{@"op": @"control",
                         @"name": @"networkMockFrom",
                         @"id": @7};
  MVCheck(@"requests: Mock This Answer asks for a rule of the request chosen", [sent.lastObject isEqual:mock], [sent.lastObject description]);
  [pane show:@{@"op": @"network",
               @"rule": @"\"a.test/x\" status=200 body=ok",
               @"fields": @{@"host": @"a.test", @"path": @"/x", @"status": @"200", @"body": @"ok"}}];
  MVCheck(@"requests: and the rule stands in the rules' field and in its fields, to be set or changed", !pane.rules.hidden && [[[pane.rules valueForKey:@"_field"] stringValue] isEqual:@"\"a.test/x\" status=200 body=ok"] && [pane.rules.form.fields isEqual:(@{@"host": @"a.test", @"path": @"/x", @"status": @"200", @"body": @"ok"})], pane.rules.form.fields.description);
  [window pokeClick:@"networkShowRequests"];
  MVPump(0.1);
  [[pane.rules valueForKey:@"_field"] setStringValue:@""];
  MVCheck(@"probe: the requests stand first, and the rules in their place when asked for", pane.rules.hidden && ![[pane valueForKey:@"_list"] isHidden], nil);
  [window pokeClick:@"networkShowRules"];
  MVPump(0.1);
  MVCheck(@"rules: shown, they take the place of the requests", !pane.rules.hidden && [[pane valueForKey:@"_list"] isHidden] && !pane.detail.length, nil);
  NSTextField *field = [pane.rules valueForKey:@"_field"];
  field.stringValue = @"a.test/z delayMs=300";
  [window pokeClick:@"networkRuleSave"];
  MVPump(0.1);
  NSDictionary *added = @{@"op": @"control",
                          @"name": @"networkRuleSave",
                          @"rule": @"a.test/z delayMs=300"};
  MVCheck(@"rules: a line typed is sent as one new rule, and never the whole list", [sent.lastObject isEqual:added], [sent.lastObject description]);
  MVPokeListRow([pane.rules valueForKey:@"_list"], second);
  MVPump(0.1);
  MVCheck(@"rules: one chosen stands in the field to be changed, and one that is off can be turned on", [field.stringValue isEqual:second] && [[[pane.rules valueForKey:@"_switch"] title] isEqual:MVWord(@"Turn On")] && [[[pane.rules valueForKey:@"_save"] title] isEqual:MVWord(@"Save Rule")], field.stringValue);
  [window pokeClick:@"networkRuleSwitch"];
  MVPump(0.1);
  NSDictionary *switched = @{@"op": @"control",
                             @"name": @"networkRuleSwitch",
                             @"id": @"bb2222",
                             @"on": @YES};
  MVCheck(@"rules: turned on by its name", [sent.lastObject isEqual:switched], [sent.lastObject description]);
  [window pokeClick:@"networkRuleRemove"];
  MVPump(0.1);
  NSDictionary *removed = @{@"op": @"control", @"name": @"networkRuleRemove", @"id": @"bb2222"};
  MVCheck(@"rules: and removed by its name, the rest left as they are", [sent.lastObject isEqual:removed], [sent.lastObject description]);
  NSDictionary *both = @{@"op": @"network",
                         @"capturing": @"probe",
                         @"rules": @[@{@"rule": first,
                                       @"id": @"aa1111",
                                       @"hits": @2},
                                     @{@"rule": second,
                                       @"id": @"bb2222",
                                       @"hits": @0,
                                       @"off": @YES}],
                         @"entries": @[]};
  [pane show:both];
  MVCheck(@"rules: a change of this window's own is not said to be another's", !pane.rules.moved, nil);
  MVPokeListRow([pane.rules valueForKey:@"_list"], first);
  MVPump(0.1);
  field.stringValue = @"a.test/x status=418";
  [pane show:@{@"op": @"network",
               @"capturing": @"probe",
               @"elsewhere": @YES,
               @"rules": @[@{@"rule": second,
                             @"id": @"bb2222",
                             @"hits": @0,
                             @"off": @YES}],
               @"entries": @[]}];
  MVCheck(@"rules: the rule in the field taken out elsewhere is said to be, and what was typed is kept to add again", pane.rules.moved && [field.stringValue isEqual:@"a.test/x status=418"] && [[[pane.rules valueForKey:@"_save"] title] isEqual:MVWord(@"Add Rule")] && [pane.answer.said isEqual:MVWord(@"The rules or the speed were changed elsewhere")], pane.answer.said);
  field.stringValue = @"";
  [pane show:both];
  MVCheckRuleFields(window, pane, sent);
  [speed selectItemAtIndex:1];
  [speed sendAction:speed.action to:speed.target];
  NSDictionary *slowed = @{@"op": @"control", @"name": @"networkThrottle", @"value": @"slow"};
  MVCheck(@"probe: a speed chosen is asked for by the op's word", [sent.lastObject isEqual:slowed], [sent.lastObject description]);
  [pane show:@{@"op": @"network",
               @"capturing": @"probe",
               @"throttle": @"delayMs=300 loss=5",
               @"entries": @[]}];
  MVCheck(@"probe: a speed an agent set in its own words stands as it was set", [speed.titleOfSelectedItem isEqual:@"delayMs=300 loss=5"], speed.titleOfSelectedItem);
}
