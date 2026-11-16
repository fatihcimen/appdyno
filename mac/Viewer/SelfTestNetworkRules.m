// The rules of the Network pane, in a window kept behind: each as a sentence with its switch, one opened to be changed
// in fields with names, and what a person's changes send, each of one rule by its name.
#import "Place.h"
#import "SelfTest.h"
#import "WindowParts.h"
#import "Words.h"

static NSDictionary *rule(NSString *line, NSString *name, NSInteger hits, BOOL off, NSDictionary *fields) {
  return @{@"rule": line,
           @"id": name,
           @"hits": @(hits),
           @"off": @(off),
           @"fields": fields};
}

void MVCheckNetworkRules(MVWindow *window, MVNetworkPane *pane, NSMutableArray<NSDictionary *> *sent) {
  MVNetworkRules *rules = pane.rules;
  MVNetworkRuleForm *form = rules.form;
  NSDictionary *first = rule(@"\"a.test/x\" method=POST status=503 body=\"{\\\"error\\\":\\\"down\\\"}\"", @"aa1111", 2, NO, @{@"method": @"POST", @"host": @"a.test", @"path": @"/x", @"status": @"503", @"body": @"{\"error\":\"down\"}"});
  NSDictionary *second = rule(@"\"a.test/y\" fail=offline off", @"bb2222", 0, YES, @{@"host": @"a.test", @"path": @"/y", @"fail": @"offline"});
  NSDictionary * (^holding)(NSArray *, NSDictionary *) = ^(NSArray *held, NSDictionary *more) {
    NSMutableDictionary *m = [@{@"op": @"network",
                                @"capturing": @"probe",
                                @"since": @1793000000000,
                                @"bodies": @YES,
                                @"rules": held,
                                @"entries": @[]} mutableCopy];
    [m addEntriesFromDictionary:more];
    return m;
  };
  NSButton * (^control)(NSString *) = ^(NSString *name) {
    return MVFindControl(pane, name);
  };
  [pane show:holding(@[], @{})];
  [window pokeClick:@"networkShowRules"];
  MVPump(0.1);
  MVCheck(@"rules: with none, a card says what a rule is, and New Rule stands under it", !rules.hidden && rules.count == 0 && !control(@"networkRuleNew").isHiddenOrHasHiddenAncestor && [[pane valueForKey:@"_list"] isHiddenOrHasHiddenAncestor] && !pane.detail.length, nil);
  [pane show:holding(@[first, second], @{@"strict": @YES,
                                         @"unmatched": @"fail"})];
  NSArray<NSString *> *says = @[@"POST a.test/x → 503 {\"error\":\"down\"}, took 2 requests", [NSString stringWithFormat:@"a.test/y → %@, %@ · took 0 requests", MVWord(@"Offline"), MVWord(@"Off")]];
  MVCheck(@"rules: each reads as a sentence, what it takes and then what it does, with what it took and whether it is off", [rules.says isEqual:says], [rules.says componentsJoinedByString:@" | "]);
  NSButton *section = control(@"networkShowRules");
  MVCheck(@"rules: the section says how many there are", [section.accessibilityLabel isEqual:[NSString stringWithFormat:@"%@, 2", MVWord(@"Rules")]], section.accessibilityLabel);
  MVLook(window, @"rules");
  NSSwitch *off = (NSSwitch *)[[[rules valueForKey:@"_rows"] arrangedSubviews][1] valueForKey:@"on"];
  [sent removeAllObjects];
  off.state = NSControlStateValueOn;
  [off sendAction:off.action to:off.target];
  NSDictionary *switched = @{@"op": @"control",
                             @"name": @"networkRuleSwitch",
                             @"id": @"bb2222",
                             @"on": @YES};
  MVCheck(@"rules: one is turned on by its own switch, by its name, without being opened", [sent.lastObject isEqual:switched] && !rules.editing, [sent.lastObject description]);
  [window pokeClick:@"networkRule.0"];
  MVPump(0.1);
  NSButton *save = control(@"networkRuleSave");
  MVCheck(@"rules: one clicked opens under the list in fields with names, filled from it", rules.editing && [form.fields isEqual:first[@"fields"]] && [save.title isEqual:MVWord(@"Save")] && !control(@"networkRuleRemove").isHiddenOrHasHiddenAncestor, form.fields.description);
  NSTextField *status = [form valueForKey:@"_texts"][@"status"];
  status.stringValue = @"404";
  [NSNotificationCenter.defaultCenter postNotificationName:NSControlTextDidChangeNotification object:status];
  MVLook(window, @"rules-edit");
  [sent removeAllObjects];
  [window pokeClick:@"networkRuleSave"];
  MVPump(0.1);
  NSMutableDictionary *changed = [first[@"fields"] mutableCopy];
  changed[@"status"] = @"404";
  NSDictionary *saved = @{@"op": @"control", @"name": @"networkRuleSave", @"id": @"aa1111", @"fields": changed};
  MVCheck(@"rules: changed in its fields, the rule is sent as fields, by its name, and never the whole list", [sent.lastObject isEqual:saved] && !rules.editing, [sent.lastObject description]);
  [pane show:holding(@[first, second], @{})];
  MVCheck(@"rules: a change of this window's own is not said to be another's", !rules.moved, nil);
  [window pokeClick:@"networkRuleNew"];
  MVPump(0.1);
  MVCheck(@"rules: a new one opens empty, to be added", rules.editing && !form.fields.count && [save.title isEqual:MVWord(@"Add")] && control(@"networkRuleRemove").isHiddenOrHasHiddenAncestor, form.fields.description);
  form.line = @"a.test/z delayMs=300";
  [sent removeAllObjects];
  [window pokeClick:@"networkRuleSave"];
  MVPump(0.1);
  NSDictionary *added = @{@"op": @"control", @"name": @"networkRuleSave", @"rule": @"a.test/z delayMs=300"};
  MVCheck(@"rules: its line typed is sent as one new rule", [sent.lastObject isEqual:added], [sent.lastObject description]);
  [pane show:holding(@[first, second], @{})];
  [window pokeClick:@"networkRule.1"];
  MVPump(0.1);
  [window pokeClick:@"networkRuleRemove"];
  MVPump(0.1);
  NSDictionary *removed = @{@"op": @"control", @"name": @"networkRuleRemove", @"id": @"bb2222"};
  MVCheck(@"rules: and one is removed by its name, the rest left as they are", [sent.lastObject isEqual:removed], [sent.lastObject description]);
  [pane show:holding(@[first, second], @{})];
  [window pokeClick:@"networkRule.0"];
  MVPump(0.1);
  status.stringValue = @"418";
  [NSNotificationCenter.defaultCenter postNotificationName:NSControlTextDidChangeNotification object:status];
  [pane show:holding(@[second], @{@"elsewhere": @YES})];
  MVLook(window, @"rules-moved");
  MVCheck(@"rules: the rule open taken out elsewhere is said to be, and what was typed is kept to add again", rules.moved && rules.editing && [form.fields[@"status"] isEqual:@"418"] && [save.title isEqual:MVWord(@"Add")] && [pane.answer.said isEqual:MVWord(@"The rules or the speed were changed elsewhere")], pane.answer.said);
  [window pokeClick:@"networkRuleCancel"];
  MVPump(0.1);
  NSButton *strict = [rules valueForKey:@"_strict"], *unmatched = [rules valueForKey:@"_unmatched"];
  [pane show:holding(@[first, second], @{@"strict": @YES,
                                         @"unmatched": @"fail"})];
  MVCheck(@"rules: what the capture holds beside them stands as an agent set it", strict.state == NSControlStateValueOn && unmatched.state == NSControlStateValueOn && !rules.editing, nil);
  unmatched.state = NSControlStateValueOff;
  [unmatched sendAction:unmatched.action to:unmatched.target];
  NSDictionary *passes = @{@"op": @"control", @"name": @"networkKeep", @"unmatched": @"pass"};
  MVCheck(@"rules: and each is set by its own switch, by the op's word", [sent.lastObject isEqual:passes], [sent.lastObject description]);
  MVTestTurkish(YES);
  [pane show:holding(@[second], @{})];
  MVCheck(@"rules: a sentence is Turkish in a Turkish window, the rule's own words as they are", [rules.says.firstObject isEqual:@"a.test/y → Çevrimdışı, Kapalı · 0 istek aldı"], rules.says.firstObject);
  MVTestTurkish(NO);
  [pane show:holding(@[first, second], @{})];
}
