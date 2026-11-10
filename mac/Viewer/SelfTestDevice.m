// The Device pane in a window kept behind: what it asks as it shows, each row as the parent reads it or why it cannot be,
// what a change sends, one at a time, what an answer says, and Put Back All.
#import "Place.h"
#import "SelfTest.h"
#import "WindowParts.h"
#import "Words.h"

/// The conditions as an emulator reads them: one changed here, one its platform has not got, one only a phone refuses.
static NSDictionary *listSaid(void) {
  return @{@"op": @"answer",
           @"name": @"device",
           @"platform": @"android",
           @"conditions": @[
             @{@"name": @"dark_mode",
               @"value": @"default (now off)",
               @"on": @NO},
             @{@"name": @"text_size",
               @"value": @"1.3",
               @"changed": @YES},
             @{@"name": @"reduce_transparency", @"why": @"Android has no Reduce Transparency setting."},
             @{@"name": @"network", @"value": @"full (-1)"},
             @{@"name": @"battery", @"value": @"default (now 85)"},
             @{@"name": @"proxy", @"value": @"none"},
             @{@"name": @"call", @"why": @"Only an emulator takes a call from here."},
             @{@"name": @"location"},
           ]};
}

void MVCheckDevice(void) {
  MVWindow *window = [MVWindow new];
  window.behind = YES;
  [window configure:@{@"title": @"device",
                      @"look": @{@"controls": @[@"home"]}}];
  [window.nsWindow setContentSize:NSMakeSize(1200, 800)];
  MVDevicePane *pane = window.inspector.device;
  NSMutableArray<NSDictionary *> *sent = [NSMutableArray array];
  pane.onSend = ^(NSDictionary *message) {
    [sent addObject:message];
  };
  // the Inspector of a window of its own stands closed until a pane is asked for
  [window showPane:MVPanePerf];
  MVPump(0.3);
  [window pokeClick:@"tabDevice"];
  MVPump(0.3);
  MVCheck(@"device: its tab shows the pane, which asks for every condition as it shows", window.inspector.chosen == MVPaneDevice && sent.count == 1 && [sent[0][@"name"] isEqual:@"deviceList"], sent.description);
  MVCheck(@"device: nothing can be changed before the device is read", [[pane shown:@"dark_mode"] hasPrefix:@"disabled"] && !MVFindControl(window.nsWindow.contentView, @"deviceBack").enabled, [pane shown:@"dark_mode"]);
  [pane show:listSaid()];
  MVPump(0.1);
  MVCheck(@"device: each row stands as the device reads it, a scale and a level as a person reads them", [[pane shown:@"dark_mode"] isEqual:@"off"] && [[pane shown:@"text_size"] isEqual:@"1.3"] && [[pane shown:@"network"] isEqual:@"full"] && [[pane shown:@"battery"] isEqual:@"85"] && [[pane shown:@"proxy"] isEqual:@""], [@[[pane shown:@"dark_mode"], [pane shown:@"text_size"], [pane shown:@"network"], [pane shown:@"battery"]] componentsJoinedByString:@"|"]);
  NSString *why = [pane shown:@"reduce_transparency"];
  MVCheck(@"device: what the device cannot do stands disabled, with its reason begun as a sentence", [why isEqual:[@"disabled: " stringByAppendingString:MVWord(@"Android has no Reduce Transparency setting.")]] && [[pane shown:@"call"] hasPrefix:@"disabled: "], why);
  MVCheck(@"device: a location has nothing to read, and can be set", ![[pane shown:@"location"] hasPrefix:@"disabled"], [pane shown:@"location"]);
  MVCheck(@"device: Put Back All stands ready where something was changed here", MVFindControl(window.nsWindow.contentView, @"deviceBack").enabled, nil);
  [sent removeAllObjects];
  [pane set:@"dark_mode" to:@"on"];
  [pane set:@"text_size" to:@"1.5"];
  NSDictionary *args = sent.firstObject[@"args"];
  MVCheck(@"device: a switch sends its condition by the op's names, once, until its answer comes", sent.count == 1 && [sent[0][@"name"] isEqual:@"deviceSet"] && [args[@"name"] isEqual:@"dark_mode"] && [args[@"value"] isEqual:@"on"] && pane.answer.waiting, sent.description);
  MVCheck(@"device: what a person moved meanwhile is not sent", [[pane shown:@"text_size"] isEqual:@"1.5"], nil);
  [pane show:@{@"op": @"answer",
               @"name": @"device",
               @"ok": @YES,
               @"text": @"dark_mode: on; put back when this session ends, or by restore",
               @"moved": @YES,
               @"conditions": @[@{@"name": @"dark_mode",
                                  @"value": @"on",
                                  @"on": @YES,
                                  @"changed": @YES}]}];
  NSString *done = MVFormat(@"%@ is now %@", @[MVWord(@"Dark Mode"), MVWord(@"On")]);
  MVCheck(@"device: what was done is said in a person's words, and the row reads as the device now does", [pane.answer.said isEqual:done] && [[pane shown:@"dark_mode"] isEqual:@"on"] && !pane.answer.waiting, pane.answer.said);
  MVCheck(@"device: and what was moved meanwhile stands again as the device reads it", [[pane shown:@"text_size"] isEqual:@"1.3"], [pane shown:@"text_size"]);
  [sent removeAllObjects];
  [pane set:@"proxy" to:@""];
  MVCheck(@"device: an empty proxy is none", [sent.firstObject[@"args"][@"value"] isEqual:@"none"], sent.description);
  [pane show:@{@"op": @"answer",
               @"name": @"device",
               @"ok": @NO,
               @"text": @"On a phone, this could cut its connection to this Mac. Change it on the phone."}];
  MVCheck(@"device: a refusal is shown whole, in the Mac's language", [pane.answer.said isEqual:MVWord(@"On a phone, this could cut its connection to this Mac. Change it on the phone.")], pane.answer.said);
  [sent removeAllObjects];
  [pane set:@"sms" to:@""];
  NSString *body = sent.firstObject[@"args"][@"value"];
  MVCheck(@"device: an empty message sends the one its field shows, in the window's language", [body isEqual:MVWord(@"Sent from the window")] && [MVInTurkish(@"Sent from the window") isEqual:@"Pencereden gönderildi"], body);
  [pane show:@{@"op": @"answer",
               @"name": @"device",
               @"ok": @YES,
               @"text": @"an SMS came from +15551234567"}];
  [sent removeAllObjects];
  [pane set:@"location" to:@"41.0082, 28.9784"];
  NSDictionary *place = sent.firstObject[@"args"];
  MVCheck(@"device: a location goes by set_location, as numbers", [sent.firstObject[@"name"] isEqual:@"deviceLocation"] && [place[@"lat"] doubleValue] == 41.0082 && [place[@"lon"] doubleValue] == 28.9784, sent.description);
  [pane show:@{@"op": @"answer",
               @"name": @"device",
               @"ok": @YES,
               @"text": @"location: 41.008200, 28.978400"}];
  [sent removeAllObjects];
  [pane set:@"location" to:@"north"];
  MVCheck(@"device: what is no place is refused here, and nothing goes", sent.count == 0 && !pane.answer.waiting && [pane.answer.said isEqual:MVWord(@"Give a latitude and a longitude, such as 41.0082, 28.9784")], pane.answer.said);
  [window pokeClick:@"deviceBack"];
  MVPump(0.2);
  MVCheck(@"device: Put Back All sends restore, by a real click", [sent.lastObject[@"name"] isEqual:@"deviceRestore"], sent.description);
  NSMutableArray *back = [NSMutableArray array];
  for (NSDictionary *row in listSaid()[@"conditions"]) {
    NSMutableDictionary *now = [row mutableCopy];
    [now removeObjectForKey:@"changed"];
    [back addObject:now];
  }
  [pane show:@{@"op": @"answer",
               @"name": @"device",
               @"ok": @YES,
               @"text": @"restored dark_mode: off; text_size: 1.0",
               @"conditions": back}];
  NSString *put = MVFormat(@"Put back: %@", @[[@[MVWord(@"Dark Mode"), MVWord(@"Text Size")] componentsJoinedByString:@", "]]);
  MVCheck(@"device: and says what went back, after which it has nothing to put back", [pane.answer.said isEqual:put] && !MVFindControl(window.nsWindow.contentView, @"deviceBack").enabled, pane.answer.said);
  [window.nsWindow displayIfNeeded];
  NSScrollView *scroll = (NSScrollView *)[[pane subviews] filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(id view, __unused NSDictionary *b) {
                                                            return [view isKindOfClass:NSScrollView.class];
                                                          }]]
                             .firstObject;
  NSView *page = scroll.documentView;
  MVCheck(@"device: its rows scroll in the room the pane has, as wide as it", scroll && page.frame.size.height > 0 && fabs(page.frame.size.width - scroll.contentView.bounds.size.width) < 1, NSStringFromRect(page.frame));
  [pane show:@{@"op": @"answer",
               @"name": @"device",
               @"platform": @"ios",
               @"conditions": @[@{@"name": @"text_size", @"value": @"extra-extra-large"}, @{@"name": @"thermal", @"value": @"ThermalStateFair"}]}];
  MVCheck(@"device: an iPhone's text size stands as read, not as the first size its name ends like", [[pane shown:@"text_size"] isEqual:@"extra-extra-large"] && [[pane shown:@"thermal"] isEqual:@"fair"], [pane shown:@"text_size"]);
  // a Samsung's own scale, none of the menu's, read 1.1 where the menu's read as percents
  [pane show:@{@"op": @"answer",
               @"name": @"device",
               @"platform": @"android",
               @"conditions": @[@{@"name": @"text_size", @"value": @"1.1"}]}];
  NSPopUpButton *size = (NSPopUpButton *)MVFindControl(window.nsWindow.contentView, @"condition:text_size");
  MVCheck(@"device: an Android scale none of the menu's is a percent too, and each of the menu's a whole one", [size.titleOfSelectedItem isEqual:MVPercent(110)] && [[pane shown:@"text_size"] isEqual:@"1.1"] && [size.itemTitles containsObject:MVPercent(115)], [size.itemTitles componentsJoinedByString:@"|"]);
}
