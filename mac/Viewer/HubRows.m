// The sidebar's rows: what a device is called and how it stands, in one name everywhere, and the places under the devices.
#import "HubParts.h"
#import "Window.h"
#import "Words.h"

NSString *const MVFoldKey = @"fold:";
NSString *const MVKindKey = @"kind:";
NSString *const MVPlaceKey = @"place:";

static const double kPlaceSeconds = 0.18;

static NSColor *_Nullable stateColor(NSDictionary *device) {
  if ([device[@"mirrored"] boolValue]) return MVAccent();
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
  // a phone goes by what it is sold as, its model's code beneath; a simulator by its model, what this Mac calls it beneath
  BOOL phone = [device[@"kind"] isEqual:@"phone"];
  row.title = named && !phone ? model : own;
  NSMutableArray<NSString *> *about = [NSMutableArray array];
  if ([parts[1] length]) [about addObject:parts[1]];
  if (named) [about addObject:phone ? model : own];
  if ([device[@"detail"] length] && ![device[@"detail"] isEqual:model]) [about addObject:device[@"detail"]];
  row.detail = [about componentsJoinedByString:@" · "];
  // whole where its Start leaves the line too little room
  row.help = row.detail.length ? [NSString stringWithFormat:@"%@\n%@", row.title, row.detail] : row.title;
  row.symbol = MVDeviceSymbol(device);
  row.tile = MVHueTile(0);
  row.dot = stateColor(device);
  row.dotShape = [device[@"mirrored"] boolValue] ? @"macwindow" : @"play.circle.fill";
  row.key = device[@"id"];
  return row;
}

/// One phone whatever the way to it: a row by the network carries its serial on the cable.
static NSString *phoneOf(NSDictionary *device) {
  return device[@"sameAs"] ?: device[@"serial"] ?
                                                : device[@"id"];
}

/// A phone that left one way in and runs by another needs nothing of a person.
static BOOL hereAnotherWay(NSDictionary *gone, NSArray<NSDictionary *> *devices) {
  for (NSDictionary *device in devices)
    if ([phoneOf(device) isEqual:phoneOf(gone)]) return YES;
  return NO;
}

/// A phone that left: dimmed and said in words, for as long as it stays the one chosen.
static MVRow *goneRow(NSDictionary *device) {
  MVRow *row = MVDeviceRow(device);
  row.detail = MVWord(@"Unplugged");
  row.dot = nil;
  row.symbol = @"cable.connector.slash";
  row.tile = nil;
  row.tint = MVOrange();
  return row;
}

@implementation MVHub (Rows)

/// A kind's section past this many folds at its header, and stays as a person left it.
static const NSUInteger kFoldPast = 8;

static NSString *kindTitle(NSString *kind) {
  return [kind isEqual:@"emulator"] ? @"Emulators" : @"Simulators";
}

/// A line of a section that is no device: why it has none, that its tool is still asked, or that there is none yet.
static MVRow *sayRow(NSString *kind, NSString *title, NSString *detail, NSString *symbol) {
  MVRow *row = [MVRow new];
  row.title = title;
  row.detail = detail;
  row.symbol = symbol;
  row.tint = MVQuietColor();
  row.wraps = YES;
  row.key = [MVKindKey stringByAppendingString:kind];
  return row;
}

/// Each kind this Mac can start has its section, empty or not: what runs first, then what is shut down, each with Start.
/// A list that folded what was shut down read as a Mac with no simulator.
- (void)listKind:(NSString *)kind about:(NSDictionary *)about into:(NSMutableArray<MVRow *> *)rows words:(NSString *)words {
  NSMutableArray<MVRow *> *running = [NSMutableArray array], *off = [NSMutableArray array];
  for (NSDictionary *device in _devices) {
    if (![device[@"kind"] isEqual:kind] || device[@"need"] || !matches(device, words)) continue;
    MVRow *row = MVDeviceRow(device);
    BOOL up = [device[@"state"] isEqual:@"running"];
    if (!up && [_starting isEqual:device[@"id"]]) row.detail = MVWord(@"Starting…");
    else if (!up) row.button = @"Start";
    [up ? running : off addObject:row];
  }
  NSUInteger count = running.count + off.count;
  BOOL foldable = count > kFoldPast && !words.length, folded = foldable && [_folds containsObject:kind];
  MVRow *header = [MVRow headerNamed:foldable ? [NSString stringWithFormat:@"%@ %@ (%lu)", folded ? @"▸" : @"▾", MVWord(kindTitle(kind)), (unsigned long)count] : MVWord(kindTitle(kind))];
  if (foldable) header.key = [MVFoldKey stringByAppendingString:kind];
  [rows addObject:header];
  NSDictionary *problem = [about[@"problem"] isKindOfClass:NSDictionary.class] ? about[@"problem"] : nil;
  if (problem) {
    // its head on the line, as a line is cut where the sidebar ends; the rest and what to do wrap beneath
    NSString *said = MVSentence(problem[@"said"] ?: @""), *fix = MVCapitalized(MVSentence(problem[@"fix"] ?: @""));
    NSRange colon = [said rangeOfString:@": "];
    NSString *head = colon.location == NSNotFound ? said : [said substringToIndex:colon.location];
    NSString *rest = colon.location == NSNotFound ? @"" : [MVCapitalized([said substringFromIndex:NSMaxRange(colon)]) stringByAppendingString:@". "];
    MVRow *why = sayRow(kind, head, [rest stringByAppendingString:fix], @"exclamationmark.triangle");
    why.help = [NSString stringWithFormat:@"%@\n%@", said, fix];
    [rows addObject:why];
  } else if (!count && [about[@"waiting"] boolValue]) [rows addObject:sayRow(kind, MVWord(@"Asking for them…"), MVWord(@"The first answer after a Mac starts can take a minute."), @"hourglass")];
  else if (!count && !words.length) {
    MVRow *none = sayRow(kind, MVWord([kind isEqual:@"emulator"] ? @"No emulator yet" : @"No simulator yet"), @"", [kind isEqual:@"emulator"] ? @"candybarphone" : @"iphone");
    none.button = @"New…";
    [rows addObject:none];
  }
  [rows addObjectsFromArray:running];
  if (!folded) [rows addObjectsFromArray:off];
}

/// The kinds the hub said it has, simulators first; a list that named none has those its devices are of.
- (NSArray<NSDictionary *> *)kindsListed {
  NSMutableArray<NSDictionary *> *kinds = [NSMutableArray array];
  for (NSString *kind in @[@"simulator", @"emulator"]) {
    NSDictionary *said = nil;
    for (NSDictionary *one in _kinds)
      if ([one isKindOfClass:NSDictionary.class] && [one[@"kind"] isEqual:kind]) said = one;
    if (said || [[_devices valueForKey:@"kind"] containsObject:kind]) [kinds addObject:said ?: @{@"kind": kind}];
  }
  return kinds;
}

/// The places first, which a long list of devices would push out of sight; then what needs a person, phones, and a
/// section for each kind of virtual device.
- (void)listDevices {
  NSString *words = _search.stringValue;
  NSMutableArray<MVRow *> *rows = [NSMutableArray array];
  [_places enumerateObjectsUsingBlock:^(MVPlace *place, NSUInteger at, __unused BOOL *stop) {
    MVRow *row = [MVRow new];
    row.title = place.title;
    row.detail = @"";
    row.symbol = place.symbol;
    row.tile = MVHueTile((NSInteger)at + 1);
    row.key = [NSString stringWithFormat:@"%@%lu", MVPlaceKey, (unsigned long)at];
    [rows addObject:row];
  }];
  NSMutableArray<MVRow *> *phones = [NSMutableArray array], *needs = [NSMutableArray array];
  for (NSDictionary *device in _devices) {
    if (!matches(device, words)) continue;
    if (device[@"need"]) [needs addObject:MVDeviceRow(device)];
    else if ([device[@"kind"] isEqual:@"phone"]) [phones addObject:MVDeviceRow(device)];
  }
  BOOL gone = _left && !hereAnotherWay(_left, _devices);
  if (needs.count || gone) [rows addObject:[MVRow headerNamed:MVWord(@"Needs You")]];
  if (gone) [rows addObject:goneRow(_left)];
  [rows addObjectsFromArray:needs];
  if (phones.count) [rows addObject:[MVRow headerNamed:MVWord(@"Phones")]];
  [rows addObjectsFromArray:phones];
  for (NSDictionary *kind in [self kindsListed]) [self listKind:kind[@"kind"] about:kind into:rows words:words];
  _list.rows = rows;
  [_list selectKey:_placeKey ?: _shown[@"id"]];
}

- (void)addPlace:(MVPlace *)place {
  if (!_places) _places = [NSMutableArray array];
  [_places addObject:place];
  [self listDevices];
}

/// A place stands where a device would, so what stood there ends as it would for another device. It has no use for an
/// Inspector, which comes back with the next device.
- (void)choosePlace:(MVPlace *)place {
  if (place.view == _placeShown) return;
  _placeByItself = NO;
  NSSplitViewItem *inspector = ((MVRoomView *)_room).slot.item;
  if (!_placeShown) _inspectorWasOpen = !inspector.collapsed;
  [self showDevice:nil];
  inspector.collapsed = YES;
  [_bare hideInspectorSwitch:YES];
  _placeShown = place.view;
  _placeKey = [NSString stringWithFormat:@"%@%lu", MVPlaceKey, (unsigned long)[_places indexOfObject:place]];
  ((MVRoomView *)_room).place = _placeShown;
  [_room addSubview:_placeShown];
  [_list selectKey:_placeKey];
  // a place says its own name, large, at the head of its page
  [_bare setName:@"" about:nil];
  [((MVRoomView *)_room).backdrop showPlace:(NSInteger)[_places indexOfObject:place] + 1];
  [_help fillDevice:_lastDevice app:MVFrontApp()];
  [_tools fillDevice:_lastDevice];
  // a backdrop fades as a device's would; a person who asked for less motion has a cut
  _placeShown.wantsLayer = YES;
  MVFade(_placeShown.layer, 0, 1, kPlaceSeconds);
}

- (void)leavePlaceFor:(nullable NSDictionary *)device {
  if (!_placeShown) return;
  [_placeShown removeFromSuperview];
  _placeShown = nil;
  _placeKey = nil;
  ((MVRoomView *)_room).place = nil;
  _room.needsLayout = YES;
  [((MVRoomView *)_room).backdrop showPlace:0];
  [_bare hideInspectorSwitch:NO];
  if (device && _inspectorWasOpen) ((MVRoomView *)_room).slot.item.collapsed = NO;
}

- (nullable NSView *)placeShown {
  return _placeShown;
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
