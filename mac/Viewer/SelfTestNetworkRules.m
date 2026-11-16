// The rules of the Network pane, in a window kept behind: what a person's changes send, each of one rule by its name,
// and what the pane shows of the rules the parent gives.
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

void MVCheckNetworkRules(MVWindow *window, MVNetworkPane *pane, NSMutableArray<NSDictionary *> *sent) {
  NSString *first = @"\"a.test/x\" status=503", *second = @"\"a.test/y\" fail=offline off";
  [pane show:@{@"op": @"network",
               @"capturing": @"probe",
               @"since": @1793000000000,
               @"bodies": @YES,
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
  MVCheck(@"rules: each stands with what it took, one that is off said to be", pane.rules.rows.count == 2 && [pane.rules.rows[1].detail hasPrefix:MVWord(@"Off")], [[pane.rules.rows valueForKey:@"detail"] componentsJoinedByString:@"|"]);
  [window pokeClick:@"networkShowRules"];
  MVPump(0.1);
  MVCheck(@"rules: shown, they take the place of the requests", !pane.rules.hidden && [[pane valueForKey:@"_list"] isHiddenOrHasHiddenAncestor] && !pane.detail.length, nil);
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
}
