// The sidebar's rows: what a device is called and how it stands, in one name everywhere, and the places under the devices.
#import "HubParts.h"
#import "Window.h"
#import "Words.h"

NSString *const MVFoldKey = @"fold";
NSString *const MVPlaceKey = @"place:";

static NSColor *_Nullable stateColor(NSDictionary *device) {
  if ([device[@"mirrored"] boolValue]) return NSColor.systemBlueColor;
  return [device[@"state"] isEqual:@"running"] ? MVGreen() : nil;
}

NSString *MVDeviceSymbol(NSDictionary *device) {
  if ([device[@"model"] hasPrefix:@"iPad"]) return @"ipad";
  return [device[@"platform"] isEqual:@"android"] ? @"candybarphone" : @"iphone";
}

static BOOL matches(NSDictionary *device, NSString *words) {
  if (!words.length) return YES;
  NSString *all = [NSString stringWithFormat:@"%@ %@", device[@"name"] ?: @"", device[@"detail"] ?: @""];
  return [all rangeOfString:words options:NSCaseInsensitiveSearch].location != NSNotFound;
}

/// A simulator's name, and the system it holds, which it carries in brackets.
NSArray<NSString *> *MVNamedParts(NSString *name) {
  NSRange open = [name rangeOfString:@" (" options:NSBackwardsSearch];
  if (open.location == NSNotFound || ![name hasSuffix:@")"]) return @[name, @""];
  NSString *inside = [name substringWithRange:NSMakeRange(NSMaxRange(open), name.length - NSMaxRange(open) - 1)];
  BOOL system = [inside hasPrefix:@"iOS"] || [inside hasPrefix:@"Android"];
  return system ? @[[name substringToIndex:open.location], inside] : @[name, @""];
}

MVRow *MVDeviceRow(NSDictionary *device) {
  MVRow *row = [MVRow new];
  // one name everywhere: what it is, then its system and what this Mac calls it
  NSArray<NSString *> *parts = MVNamedParts(device[@"name"] ?: @"");
  NSString *model = device[@"model"], *own = parts[0];
  BOOL named = model.length && ![model isEqual:own];
  row.title = named ? model : own;
  NSMutableArray<NSString *> *about = [NSMutableArray array];
  if ([parts[1] length]) [about addObject:parts[1]];
  if (named) [about addObject:own];
  if ([device[@"detail"] length] && ![device[@"detail"] isEqual:model]) [about addObject:device[@"detail"]];
  row.detail = [about componentsJoinedByString:@" · "];
  row.symbol = MVDeviceSymbol(device);
  row.dot = stateColor(device);
  row.key = device[@"id"];
  return row;
}

/// A phone that left: dimmed and said in words, for as long as it stays the one chosen.
static MVRow *goneRow(NSDictionary *device) {
  MVRow *row = MVDeviceRow(device);
  row.detail = @"Unplugged";
  row.dot = nil;
  row.symbol = @"cable.connector.slash";
  row.tint = MVOrange();
  return row;
}

@implementation MVHub (Rows)

/// Phones first, then what runs, and what is shut down folded away: a person's Mac may have a hundred of them.
- (void)listDevices {
  NSString *words = _search.stringValue;
  NSMutableArray<MVRow *> *phones = [NSMutableArray array], *running = [NSMutableArray array], *off = [NSMutableArray array], *needs = [NSMutableArray array];
  for (NSDictionary *device in _devices) {
    if (!matches(device, words)) continue;
    BOOL phone = [device[@"kind"] isEqual:@"phone"], up = [device[@"state"] isEqual:@"running"];
    [device[@"need"] ? needs : phone ? phones : up ? running : off addObject:MVDeviceRow(device)];
  }
  NSMutableArray<MVRow *> *rows = [NSMutableArray array];
  if (needs.count || _left) [rows addObject:[MVRow headerNamed:@"Needs You"]];
  if (_left) [rows addObject:goneRow(_left)];
  [rows addObjectsFromArray:needs];
  [running insertObjects:phones atIndexes:[NSIndexSet indexSetWithIndexesInRange:NSMakeRange(0, phones.count)]];
  if (running.count) [rows addObject:[MVRow headerNamed:@"Running"]];
  [rows addObjectsFromArray:running];
  if (off.count) {
    BOOL open = _unfolded || words.length;
    MVRow *fold = [MVRow headerNamed:[NSString stringWithFormat:@"%@ Shut Down (%lu)", open ? @"▾" : @"▸", (unsigned long)off.count]];
    fold.key = MVFoldKey;
    [rows addObject:fold];
    if (open) [rows addObjectsFromArray:off];
  }
  [_places enumerateObjectsUsingBlock:^(MVPlace *place, NSUInteger at, BOOL *stop) {
    MVRow *row = [MVRow new];
    row.title = place.title;
    row.detail = @"";
    row.symbol = place.symbol;
    row.key = [NSString stringWithFormat:@"%@%lu", MVPlaceKey, (unsigned long)at];
    [rows addObject:row];
  }];
  _list.rows = rows;
  [_list selectKey:_shown[@"id"]];
}

- (void)addPlace:(MVPlace *)place {
  if (!_places) _places = [NSMutableArray array];
  [_places addObject:place];
  [self listDevices];
}

/// A place stands where a device would, so what stood there ends as it would for another device.
- (void)choosePlace:(MVPlace *)place {
  [self showDevice:nil];
  [_placeShown removeFromSuperview];
  _placeShown = place.view;
  _placeShown.frame = _room.bounds;
  _placeShown.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [_room addSubview:_placeShown];
}

- (BOOL)sidebarClosed {
  return _sidebarItem.collapsed;
}

- (NSArray<NSString *> *)rowTitles {
  return [_list.rows valueForKey:@"title"];
}

/// What the sidebar says of a device, for the bar over it.
- (nullable NSDictionary *)rowFor:(NSString *)serial {
  for (NSDictionary *device in _devices) {
    if (![(device[@"serial"] ?: device[@"id"]) isEqual:serial]) continue;
    MVRow *row = MVDeviceRow(device);
    return @{@"title": row.title ?: @"", @"about": row.detail ?: @"", @"link": device[@"link"] ?: @""};
  }
  return nil;
}

/// Who came and who left, for a person who cannot see the list change. The first list says nothing: nothing moved.
- (void)sayWhatMoved {
  NSMutableSet<NSString *> *now = [NSMutableSet set];
  NSMutableDictionary<NSString *, NSString *> *names = [NSMutableDictionary dictionary];
  for (NSDictionary *device in _devices) {
    if (![device[@"state"] isEqual:@"running"]) continue;
    [now addObject:device[@"id"]];
    names[device[@"id"]] = MVDeviceRow(device).title;
  }
  if (_seen) {
    for (NSString *id in now)
      if (![_seen containsObject:id]) MVAnnounce([NSString stringWithFormat:@"%@ connected", names[id]]);
    for (NSString *id in _seen)
      if (![now containsObject:id] && _seenNames[id]) MVAnnounce([NSString stringWithFormat:@"%@ unplugged", _seenNames[id]]);
  }
  _seen = now;
  _seenNames = names;
}

@end
