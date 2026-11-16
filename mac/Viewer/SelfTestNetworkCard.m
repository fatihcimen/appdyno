// The card of the request chosen in the Network pane, in a window kept behind.
#import "Place.h"
#import "SelfTest.h"
#import "WindowParts.h"
#import "Words.h"

/// The card of the request chosen: its head, how its time was spent, one section at a time, and the whole pane when asked.
/// The text view of that name under a view.
static NSTextView *_Nullable MVFindText(NSView *view, NSString *name) {
  if ([view isKindOfClass:NSTextView.class] && [view.identifier isEqual:name]) return (NSTextView *)view;
  for (NSView *child in view.subviews) {
    NSTextView *found = MVFindText(child, name);
    if (found) return found;
  }
  return nil;
}

void MVCheckNetworkCard(MVWindow *window, MVNetworkPane *pane, NSDictionary *parts) {
  MVNetworkDetailView *card = [pane valueForKey:@"_detailView"];
  MVList *list = [pane valueForKey:@"_list"];
  NSView *row = [pane valueForKey:@"_captureRow"], *listCard = [pane valueForKey:@"_listCard"];
  [pane show:@{@"op": @"network", @"detail": parts}];
  // a figure and its unit stay on one line, by a space that does not break
  NSString *plain = [card.head stringByReplacingOccurrencesOfString:@"\u00A0" withString:@" "];
  MVCheck(@"card: its head says how the request ended, what was done to it, its address and how its time was spent", [plain hasPrefix:@"200 | Mocked · 3 ms | GET  https://a.test/x | DNS 1 ms"] && [plain containsString:@"Connect 2 ms"] && [plain containsString:@"Wait 5 ms"] && [plain containsString:@"Receive 1.25 s"], card.head);
  MVCheck(@"card: what a rule answered opens on what came back, set out to be read", card.section == 2 && [card.shown isEqual:@"{\n  \"error\": \"down\"\n}"], card.shown);
  [window pokeClick:@"networkHeaders"];
  MVPump(0.1);
  NSString *headers = [NSString stringWithFormat:@"%@\nAuthorization\t•••\n\n%@\nContent-Type\tapplication/json\n", MVWord(@"Request"), MVWord(@"Response")];
  MVCheck(@"card: its headers stand each under whose they are, a name and its value, a hidden one hidden", card.section == 0 && [card.shown isEqual:headers], card.shown);
  // the list is read again every few seconds: the section a person chose, and what they selected in it, stay
  NSTextView *well = MVFindText(card, @"networkDetail");
  well.selectedRange = NSMakeRange(8, 13);
  [pane show:@{@"op": @"network",
               @"capturing": @"probe",
               @"since": @1793000000000,
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
                               @"ms": @9}]}];
  pane.filter.words = @"x";
  pane.filter.words = @"";
  MVCheck(@"card: read again, and the list narrowed and widened, it keeps its section, its words and what was selected in them", card.section == 0 && [card.shown isEqual:headers] && NSEqualRanges(well.selectedRange, NSMakeRange(8, 13)), [NSString stringWithFormat:@"%ld %@", (long)card.section, NSStringFromRange(well.selectedRange)]);
  [window pokeClick:@"networkRequest"];
  MVPump(0.1);
  MVCheck(@"card: a section with nothing in it says why", [card.shown isEqual:MVWord(@"It sent no body.")], card.shown);
  NSMutableDictionary *bare = [parts mutableCopy];
  bare[@"kept"] = @NO;
  [pane show:@{@"op": @"network", @"detail": bare}];
  MVCheck(@"card: one whose headers and bodies were not kept says so in their place, and what to do", [card.shown isEqual:MVWord(@"Its headers and bodies were not kept. Start a capture with them kept to read them.")], card.shown);
  [pane show:@{@"op": @"network", @"detail": parts}];
  [window pokeClick:@"networkResponse"];
  MVPump(0.1);
  MVLook(window, @"request");
  MVCheck(@"card: it stands under the list, the row it belongs to in sight above it", MVStands(card, pane) && MVStands(listCard, pane) && NSMinY([card convertRect:card.bounds toView:pane]) < NSMinY([listCard convertRect:listCard.bounds toView:pane]) && list.selected, nil);
  [window pokeClick:@"networkFull"];
  MVPump(0.1);
  MVLook(window, @"request-full");
  MVCheck(@"card: opened full it has the pane, the bands and the list out of its way", card.full && MVStands(card, pane) && row.isHiddenOrHasHiddenAncestor && listCard.isHiddenOrHasHiddenAncestor && pane.filter.isHiddenOrHasHiddenAncestor && NSHeight(card.frame) > 400, NSStringFromRect(card.frame));
  list.onKey(@"escape");
  MVCheck(@"card: Esc brings the list back, the request still chosen", !card.full && MVStands(row, pane) && MVStands(listCard, pane) && [list.selected.key isEqual:@"7"] && pane.detail.length, nil);
  list.onKey(@"open");
  BOOL opened = card.full;
  [window pokeClick:@"networkFull"];
  MVPump(0.1);
  MVCheck(@"card: Return in the list opens it full, and its own button brings the list back", opened && !card.full && MVStands(listCard, pane), nil);
}
