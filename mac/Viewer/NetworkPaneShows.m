// What the parent tells the Network pane, the list the pane makes of it, and the request chosen in that list.
#import "NetworkPane.h"
#import "Place.h"
#import "Words.h"

@implementation MVNetworkPane (Shows)

/// The rows a person's words leave: each word in a row's method and address, in its figures or in how it stands, in any
/// case and with or without the marks on a letter; and with the scope on, only what failed.
- (void)listRows {
  NSArray<NSString *> *words = [MVFolded(_filter.words) componentsSeparatedByCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
  _filter.failed = [_allRows filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"bad == YES"]].count;
  BOOL scoped = _filter.failedOnly, narrowed = scoped || _filter.words.length;
  NSArray<MVRow *> *left = [_allRows filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(MVRow *row, __unused NSDictionary *bindings) {
                                       if (scoped && !row.bad) return NO;
                                       NSString *all = MVFolded([NSString stringWithFormat:@"%@ %@ %@", row.title, row.detail, row.finds ?: @""]);
                                       for (NSString *word in words)
                                         if (word.length && ![all containsString:word]) return NO;
                                       return YES;
                                     }]];
  // those left stand under their hosts, a host with none left gone with them; what a person looked for is not kept
  // closed away from them
  _list.rows = MVNetworkGrouped(left, narrowed ? nil : _closed);
}

/// The filter changed: the list again, and the request chosen as it stands in it.
- (void)sifted {
  [self listRows];
  [self layOut];
  [self showDetail:_list.selected.key];
}

/// The request chosen, whole: its address, what came back, when, and what failed.
- (void)showDetail:(nullable NSString *)key {
  NSUInteger at = [_entries indexOfObjectPassingTest:^BOOL(NSDictionary *one, NSUInteger i, __unused BOOL *stop) {
    return [one isKindOfClass:NSDictionary.class] && [MVNetworkKey(one, i) isEqual:key];
  }];
  NSDictionary *e = at == NSNotFound ? nil : _entries[at];
  _detailCard.hidden = !e || _onRules;
  _requestTools.hidden = _detailCard.hidden || !self.probing;
  if (!e) return;
  // what opened under the list took room from it: the row it belongs to stays in sight
  [self layoutSubtreeIfNeeded];
  [_list showSelected];
  // its headers and bodies are asked for once, where the capture keeps them, and stand in place of the line
  if (_keeps && key && ![key isEqual:_askedKey]) {
    _askedKey = key;
    if (_real) MVPaneSend(self, @{@"op": @"control", @"name": @"networkDetail", @"id": @(key.integerValue), @"real": @YES});
    else MVPaneSend(self, @{@"op": @"control", @"name": @"networkDetail", @"id": @(key.integerValue)});
  }
  if (_whole && [key isEqual:_wholeKey]) {
    if (![_detail.string isEqual:_whole]) _detail.string = _whole;
    _detail.textColor = MVInkColor();
    return;
  }
  NSMutableArray<NSString *> *lines = [NSMutableArray array];
  if ([e[@"url"] length]) [lines addObject:[NSString stringWithFormat:@"%@ %@", e[@"method"] ?: @"GET", e[@"url"]]];
  else [lines addObject:MVNetworkRow(e, 0).title];
  [lines addObject:MVNetworkFigures(e)];
  if ([e[@"at"] length]) [lines addObject:MVFormat(@"At %@", @[e[@"at"]])];
  if ([e[@"body"] boolValue]) [lines addObject:MVWord(@"Its body is in the proxy's export")];
  // the same words again keep what a person selected in them
  NSString *words = [lines componentsJoinedByString:@"\n"];
  if (![_detail.string isEqual:words]) _detail.string = words;
  _detail.textColor = MVInkColor();
}

@end
