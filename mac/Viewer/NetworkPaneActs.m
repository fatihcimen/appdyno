// What a person does in the Network pane: starts and stops a capture, chooses what it keeps and shows, and acts on the
// capture and on one request, each by the name the parent takes it by.
#import "NetworkPane.h"
#import "Place.h"
#import "Words.h"

static NSString *const kBodiesKept = @"networkBodies";

@implementation MVNetworkPane (Acts)

/// A menu kept off every screen would open on a person's: a window kept behind opens none, and its items are chosen by name.
- (void)openMenu:(id)sender {
  if (MVPlaceIsBehind()) return;
  [_menu popUpMenuPositioningItem:nil atLocation:NSMakePoint(0, NSHeight(_more.bounds) + 4) inView:_more];
}

- (BOOL)probing {
  return [_capturing isEqual:@"probe"];
}

- (BOOL)validateMenuItem:(NSMenuItem *)item {
  if (item.menu == _list.rowMenu) return YES;
  item.state = [item.identifier isEqual:@"networkReal"] && _real ? NSControlStateValueOn : NSControlStateValueOff;
  return self.probing;
}

- (void)menuChosen:(NSMenuItem *)item {
  [self choose:item.identifier];
}

/// What was sent shows as it was sent, in this window alone and only while a person keeps it so: the pane's own button
/// wears the mark of it, and the request chosen is asked for again.
- (void)setReal:(BOOL)real {
  _real = real;
  [_more paint:real ? @"eye.circle.fill" : @"ellipsis.circle" color:real ? MVOrange() : MVInkColor()];
  _more.toolTip = MVWord(real ? @"More. Real values show in this window." : @"More");
  _askedKey = nil;
  _parts = nil;
}

/// One at a time: a second press would race the first for what the pane says.
- (void)go:(id)sender {
  if (_answer.waiting) return;
  NSInteger chosen = _way.indexOfSelectedItem;
  if (!_capturing && (chosen < 0 || chosen >= (NSInteger)_ways.count)) return;
  _go.enabled = NO;
  [self foot:@{@"sending": MVWord(_capturing ? @"Stopping the capture" : @"Starting the capture")}];
  if (_capturing) MVPaneSend(self, @{@"op": @"control", @"name": @"networkStop"});
  else if ([_ways[chosen] isEqual:@"probe"] && _bodies.state == NSControlStateValueOn) MVPaneSend(self, @{@"op": @"control", @"name": @"networkStart", @"via": _ways[chosen], @"bodies": @YES});
  else MVPaneSend(self, @{@"op": @"control", @"name": @"networkStart", @"via": _ways[chosen]});
}

/// A person's choice of what a capture keeps holds for the next one too; a window kept behind for a test keeps nothing.
- (void)bodiesChosen:(id)sender {
  if (!MVPlaceIsBehind()) [NSUserDefaults.standardUserDefaults setBool:_bodies.state == NSControlStateValueOn forKey:kBodiesKept];
}

- (void)send:(NSString *)name {
  MVPaneSend(self, @{@"op": @"control", @"name": name});
}

/// A button of the detail's head: the request it shows is the one chosen.
- (void)detailAct:(NSString *)name {
  if ([name isEqual:@"networkFull"]) return [self openFull:!_full];
  [self act:name on:_list.selected.key];
}

- (void)openFull:(BOOL)full {
  _full = full && _list.selected;
  [self layOut];
  [self showDetail:_list.selected.key];
}

- (void)sectionChosen:(NSInteger)at {
  _onRules = at == 1;
  [self layOut];
  [self showDetail:_list.selected.key];
}

- (void)readAgain:(id)sender {
  [self send:@"networkRead"];
}

- (void)wayChosen:(id)sender {
  [self layOut];
}

/// A host's heading clicked: its requests close under it, or open again.
- (void)toggle:(NSString *)host {
  if ([_closed containsObject:host]) [_closed removeObject:host];
  else [_closed addObject:host];
  [self listRows];
  [self layOut];
  [self showDetail:_list.selected.key];
}

/// Esc in the list: a request opened full goes back under the list; otherwise the request chosen is left, and its card closes.
- (void)leave {
  if (_full) return [self openFull:NO];
  [_list selectKey:nil];
  [self showDetail:nil];
}

/// What is done to one request, by the name the parent takes it by, or here where the window can do it alone: its
/// address copied, and the list narrowed to its host.
- (void)act:(NSString *)name on:(nullable NSString *)key {
  NSUInteger at = [_entries indexOfObjectPassingTest:^BOOL(NSDictionary *one, NSUInteger i, __unused BOOL *stop) {
    return [one isKindOfClass:NSDictionary.class] && [MVNetworkKey(one, i) isEqual:key];
  }];
  if (at == NSNotFound) return;
  NSURL *url = [NSURL URLWithString:[_entries[at][@"url"] description] ?: @""];
  if ([name isEqual:@"networkCopyUrl"]) return MVCopyText(url.absoluteString ?: @"", MVPlaceBoard());
  if ([name isEqual:@"networkOnlyHost"]) {
    _filter.words = url.host ?: @"";
    return;
  }
  if (!self.probing) return;
  NSMutableDictionary *m = [@{@"op": @"control", @"name": name, @"id": @(key.integerValue)} mutableCopy];
  if ([name isEqual:@"networkCurl"] && _real) m[@"real"] = @YES;
  MVPaneSend(self, m);
}

/// What there is to do with a request, each by its name here and the words a person reads: the same in the menu of a
/// row and for a screen reader. What reads the capture is offered only while one runs.
- (NSArray<NSArray<NSString *> *> *)deeds {
  NSMutableArray<NSArray<NSString *> *> *deeds = [NSMutableArray array];
  if (self.probing) [deeds addObjectsFromArray:@[@[@"networkCurl", _real ? @"Copy as cURL with Real Values" : @"Copy as cURL"], @[@"networkMockFrom", @"Mock This Answer"]]];
  [deeds addObjectsFromArray:@[@[@"networkCopyUrl", @"Copy Address"], @[@"networkOnlyHost", @"Show Only This Host"]]];
  return deeds;
}

- (NSArray<NSAccessibilityCustomAction *> *)actionsOn:(NSString *)key {
  NSMutableArray<NSAccessibilityCustomAction *> *actions = [NSMutableArray array];
  __weak MVNetworkPane *weak = self;
  for (NSArray<NSString *> *deed in self.deeds)
    [actions addObject:[[NSAccessibilityCustomAction alloc] initWithName:MVWord(deed[1])
                                                                 handler:^BOOL {
                                                                   [weak act:deed[0] on:key];
                                                                   return YES;
                                                                 }]];
  return actions;
}

/// The menu of a row, made as it opens for the row it opens on: rows are read again under an open menu, and the one
/// clicked is kept by its own name.
- (void)menuNeedsUpdate:(NSMenu *)menu {
  if (menu != _list.rowMenu) return;
  [menu removeAllItems];
  _menuKey = _list.clickedKey;
  if (!_menuKey || [_menuKey hasPrefix:@"host "]) return;
  for (NSArray<NSString *> *deed in self.deeds) {
    NSMenuItem *item = [menu addItemWithTitle:MVWord(deed[1]) action:@selector(rowChosen:) keyEquivalent:@""];
    item.target = self;
    item.identifier = deed[0];
  }
}

- (void)rowChosen:(NSMenuItem *)item {
  [self act:item.identifier on:_menuKey];
}

@end
