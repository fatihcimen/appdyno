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
  _whole = nil;
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

/// What is done to the request chosen names it, and says whether real values are wanted.
- (void)pressed:(NSButton *)sender {
  NSString *key = _list.selected.key;
  if (!key || !self.probing) return;
  NSMutableDictionary *m = [@{@"op": @"control", @"name": sender.identifier, @"id": @(key.integerValue)} mutableCopy];
  if ([sender.identifier isEqual:@"networkCurl"] && _real) m[@"real"] = @YES;
  MVPaneSend(self, m);
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

@end
