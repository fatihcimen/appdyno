// What a person asks of a device from the hub: start and stop it, make one, open it in a window, pair it.
#import "HubParts.h"
#import "Words.h"

@implementation MVHub (Acts)

- (void)askNew:(NSButton *)sender {
  NSMenu *menu = [[NSMenu alloc] initWithTitle:@"New"];
  [menu addItemWithTitle:MVWord(@"New Simulator…") action:@selector(newSimulator:) keyEquivalent:@""].target = self;
  [menu addItemWithTitle:MVWord(@"New Emulator…") action:@selector(newEmulator:) keyEquivalent:@""].target = self;
  [menu popUpMenuPositioningItem:nil atLocation:NSMakePoint(0, sender.bounds.size.height + 6) inView:sender];
}

/// The sheet stands at once and asks what can be made as it opens: what failed or was slow at the hub's start may answer now.
- (void)ask:(NSString *)kind {
  if (_window.attachedSheet) return;
  _asking = [MVNewDevice new];
  [_asking askIn:_window kind:kind];
}

- (void)newSimulator:(id)sender {
  [self ask:@"simulator"];
}

- (void)newEmulator:(id)sender {
  [self ask:@"emulator"];
}

/// One made is chosen as soon as it is listed, and started by the hub; a failure stays in the sheet.
- (void)heardMade:(NSDictionary *)made {
  if (!made[@"id"]) return [_asking failed:made[@"problem"]];
  [_asking done];
  _starting = made[@"id"];
  _made = made[@"id"];
  [self chooseMade];
}

/// What was just made, chosen once the list has it: the hub lists it a moment after it says it made it.
- (void)chooseMade {
  NSDictionary *device = [self deviceKeyed:_made];
  if (!device) return;
  _made = nil;
  _opening = nil;
  _placeByItself = NO;
  [self showDevice:device];
}

/// Starting takes seconds to a minute: the device says so meanwhile, where its Start was.
- (void)start:(NSDictionary *)device {
  if ([device[@"kind"] isEqual:@"phone"] || [device[@"state"] isEqual:@"running"]) return;
  _starting = device[@"id"];
  MVEmit(@{@"op": @"hub", @"action": @"start", @"id": device[@"id"]});
  [self listDevices];
  if ([_shown[@"id"] isEqual:device[@"id"]]) [self showDevice:_shown];
}

/// A row's own button: Start where it is shut down, New where its kind has none yet.
- (void)rowPressed:(MVRow *)row {
  if ([row.key hasPrefix:MVKindKey]) return [self ask:[row.key substringFromIndex:MVKindKey.length]];
  NSDictionary *device = [self deviceKeyed:row.key];
  [self showDevice:device];
  [self start:device];
}

- (void)togglePower:(id)sender {
  if (!_shown) return [self goTo:@"Connect a Phone"];
  if ([_shown[@"mirrored"] boolValue]) return MVEmit(@{@"op": @"hub", @"action": @"close", @"serial": _shown[@"serial"] ?: _shown[@"id"]});
  if ([_shown[@"state"] isEqual:@"running"]) return MVEmit(@{@"op": @"hub", @"action": @"stop", @"id": _shown[@"id"]});
  [self start:_shown];
}

/// The row a person's secondary click is on, beside the device shown.
- (void)besideClicked:(id)sender {
  [self pairWith:[self deviceKeyed:_list.clickedKey]];
}

- (void)startClicked:(id)sender {
  [self start:[self deviceKeyed:_list.clickedKey]];
}

/// A row's menu offers what its device can do now: Start where it is shut down, the rest where it runs.
- (BOOL)validateMenuItem:(NSMenuItem *)item {
  NSDictionary *device = [self deviceKeyed:_list.clickedKey];
  BOOL running = [device[@"state"] isEqual:@"running"], phone = [device[@"kind"] isEqual:@"phone"];
  if (item.action == @selector(startClicked:)) return device && !phone && !running && ![_starting isEqual:device[@"id"]];
  if (item.action == @selector(shutDownClicked:)) return device && !phone && running;
  if (item.action == @selector(besideClicked:)) return running && _shown && ![device[@"id"] isEqual:_shown[@"id"]];
  if (item.action == @selector(openClicked:)) return running;
  return YES;
}

/// A phone is a person's to turn off.
- (void)shutDownClicked:(id)sender {
  NSDictionary *device = [self deviceKeyed:_list.clickedKey];
  if (![device[@"kind"] isEqual:@"phone"] && [device[@"state"] isEqual:@"running"]) MVEmit(@{@"op": @"hub", @"action": @"stop", @"id": device[@"id"]});
}

- (void)openClicked:(id)sender {
  [self choose:_list.clickedKey];
  [self openWindow:sender];
}

- (void)openWindow:(id)sender {
  if (!_shown) return;
  MVEmit(@{@"op": @"hub", @"action": [_shown[@"mirrored"] boolValue] ? @"close" : @"open", @"id": _shown[@"id"], @"serial": _shown[@"serial"] ?: _shown[@"id"]});
}

/// What is up to stand beside the device shown.
- (NSArray<NSDictionary *> *)others {
  NSMutableArray *others = [NSMutableArray array];
  for (NSDictionary *device in _devices)
    if ([device[@"state"] isEqual:@"running"] && ![device[@"id"] isEqual:_shown[@"id"]]) [others addObject:device];
  return others;
}

- (void)pairWith:(nullable NSDictionary *)device {
  if (!_shown || !device) return;
  MVEmit(@{@"op": @"hub", @"action": @"pair", @"serial": _shown[@"serial"] ?: _shown[@"id"], @"with": device[@"serial"] ?: device[@"id"]});
}

@end
