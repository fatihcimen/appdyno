// What the parent tells the Network pane, the list the pane makes of it, and the request chosen in that list.
#import "NetworkPane.h"
#import "Place.h"
#import "Words.h"

static const double kDetailHeight = 236, kListLeast = 96, kDetailLeast = 150;

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

/// The request chosen, on its card under the list: drawn at once from its row, and its parts asked for once, where the
/// capture keeps them. The card takes its room as it opens, and the row it belongs to stays in sight above it.
- (void)showDetail:(nullable NSString *)key {
  NSUInteger at = [_entries indexOfObjectPassingTest:^BOOL(NSDictionary *one, NSUInteger i, __unused BOOL *stop) {
    return [one isKindOfClass:NSDictionary.class] && [MVNetworkKey(one, i) isEqual:key];
  }];
  NSDictionary *e = at == NSNotFound ? nil : _entries[at];
  BOOL opens = _detailView.hidden && e && !_onRules;
  _detailView.hidden = !e || _onRules;
  if (!e) {
    if (_full) [self layOut];
    return [_split adjustSubviews];
  }
  if (_keeps && key && ![key isEqual:_askedKey]) {
    _askedKey = key;
    if (_real) MVPaneSend(self, @{@"op": @"control", @"name": @"networkDetail", @"id": @(key.integerValue), @"real": @YES});
    else MVPaneSend(self, @{@"op": @"control", @"name": @"networkDetail", @"id": @(key.integerValue)});
  }
  BOOL has = _parts && [key isEqual:_wholeKey];
  NSMutableDictionary *entry = [e mutableCopy];
  entry[@"id"] = key;
  _detailView.live = self.probing;
  _detailView.why = !_capturing && _wasProbe ? MVWord(@"The capture has ended, and the headers and bodies it kept went with it.") : self.probing && !_keeps ? MVWord(@"Its headers and bodies were not kept. Start a capture with them kept to read them.")
                                                                                                                                                            : nil;
  _detailView.real = _real;
  [_detailView showEntry:entry reading:_keeps && !has];
  if (has) [_detailView showParts:_parts];
  if (!opens) return;
  [self layoutSubtreeIfNeeded];
  [_split adjustSubviews];
  [_split setPosition:MAX(NSHeight(_split.bounds) - kDetailHeight - _split.dividerThickness, kListLeast) ofDividerAtIndex:0];
  // once the list has its new height, the row this belongs to comes into sight
  [self layoutSubtreeIfNeeded];
  [_list showSelected];
  MVList *list = _list;
  dispatch_async(dispatch_get_main_queue(), ^{
    [list showSelected];
  });
}

/// The list keeps a few rows and the card its head and a few lines, however the line between them is moved.
- (CGFloat)splitView:(NSSplitView *)split constrainMinCoordinate:(CGFloat)least ofSubviewAt:(NSInteger)divider {
  return kListLeast;
}

- (CGFloat)splitView:(NSSplitView *)split constrainMaxCoordinate:(CGFloat)most ofSubviewAt:(NSInteger)divider {
  return MAX(NSHeight(split.bounds) - kDetailLeast, kListLeast);
}

@end
