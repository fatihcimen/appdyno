// The Network pane's part that only the probe has, in a window kept behind: what it sends for a person's choices,
// and what it shows of the parent's answers.
#import "Place.h"
#import "SelfTest.h"
#import "WindowParts.h"
#import "Words.h"

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
                             @"hits": @2},
                           @{@"rule": second,
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
  MVPokeListRow([pane valueForKey:@"_list"], @"GET a.test/x");
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
  MVCheck(@"probe: the requests stand first, and the rules in their place when asked for", pane.rules.hidden && ![[pane valueForKey:@"_list"] isHidden], nil);
  [window pokeClick:@"networkShowRules"];
  MVPump(0.1);
  MVCheck(@"rules: shown, they take the place of the requests", !pane.rules.hidden && [[pane valueForKey:@"_list"] isHidden] && !pane.detail.length, nil);
  NSTextField *field = [pane.rules valueForKey:@"_field"];
  field.stringValue = @"a.test/z delayMs=300";
  [window pokeClick:@"networkRuleSave"];
  MVPump(0.1);
  NSDictionary *added = @{@"op": @"control",
                          @"name": @"networkRules",
                          @"rules": @[first, second, @"a.test/z delayMs=300"]};
  MVCheck(@"rules: a line typed goes after the rest, the list sent whole", [sent.lastObject isEqual:added], [sent.lastObject description]);
  MVPokeListRow([pane.rules valueForKey:@"_list"], second);
  MVPump(0.1);
  MVCheck(@"rules: one chosen stands in the field to be changed, and one that is off can be turned on", [field.stringValue isEqual:second] && [[[pane.rules valueForKey:@"_switch"] title] isEqual:MVWord(@"Turn On")] && [[[pane.rules valueForKey:@"_save"] title] isEqual:MVWord(@"Save Rule")], field.stringValue);
  [window pokeClick:@"networkRuleSwitch"];
  MVPump(0.1);
  NSDictionary *switched = @{@"op": @"control",
                             @"name": @"networkRuleSwitch",
                             @"at": @1,
                             @"on": @YES};
  MVCheck(@"rules: turned on by its place in the list", [sent.lastObject isEqual:switched], [sent.lastObject description]);
  [window pokeClick:@"networkRuleRemove"];
  MVPump(0.1);
  MVCheck(@"rules: and removed, the rest sent", [sent.lastObject[@"rules"] isEqual:@[first]], [sent.lastObject description]);
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
