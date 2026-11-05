// The hub's two places: how a person comes to AI Clients and Help, and what they are told as they do.
#import "HubParts.h"
#import "Place.h"
#import "Words.h"

@implementation MVHub (Places)

- (void)addOwnPlaces {
  _clients = [MVClientsPane new];
  _help = [MVHelpPane new];
  _connect = [MVConnectPane new];
  _tools = [MVToolsPane new];
  __weak MVHub *weak = self;
  _connect.onReady = ^(NSString *serial) {
    [weak openWhenListed:serial];
  };
  _connect.onNew = ^(NSString *kind) {
    [weak ask:kind];
  };
  _connect.onPlace = ^(NSString *title) {
    [weak goTo:title];
  };
  __weak MVHelpPane *help = _help;
  _clients.onNotes = ^(NSArray *notes) {
    [help showNotes:notes];
  };
  _clients.onDoctor = ^(NSArray *checks) {
    [help showDoctor:checks];
  };
  NSArray *own = @[@[@"Connect a Phone", @"cable.connector", _connect], @[@"Tools", @"wrench.and.screwdriver", _tools], @[@"AI Clients", @"sparkles", _clients], @[@"Help", @"questionmark.circle", _help]];
  for (NSArray *one in own) {
    MVPlace *place = [MVPlace new];
    place.title = MVWord(one[0]);
    place.symbol = one[1];
    place.view = one[2];
    [self addPlace:place];
  }
  _connectPlace = _places.firstObject;
}

- (void)offerConnect {
  if (_placeShown || _shown || _left) return;
  [self choosePlace:_connectPlace];
  _placeByItself = YES;
}

- (void)goTo:(NSString *)title {
  [self leaveNote];
  for (MVPlace *place in _places)
    if ([place.title isEqual:MVWord(title)]) [self choosePlace:place];
}

- (void)openWhenListed:(NSString *)serial {
  _opening = serial;
  [self openWaiting];
}

- (void)openWaiting {
  for (NSDictionary *device in _devices) {
    if (!_opening || ![(device[@"serial"] ?: device[@"id"]) isEqual:_opening]) continue;
    _opening = nil;
    [self showDevice:device];
    [self sayWhatToTry];
  }
}

/// One sentence over the device that just came, and AI Clients a click away. Solid and no glass: it is no control of the device.
- (void)sayWhatToTry {
  [self leaveNote];
  NSButton *clients = MVPlacePrimary(@"AI Clients", @"noteClients", self, @selector(noteClients:));
  NSButton *close = MVPlaceButton(@"Close", @"noteClose", self, @selector(leaveNote));
  NSStackView *line = [NSStackView stackViewWithViews:@[MVText(@"Ask your AI app what is on its screen.", MVStyleBody), clients, close]];
  line.spacing = 8;
  _note = MVNote(line);
  ((MVRoomView *)_room).note = _note;
  [_room addSubview:_note];
}

- (void)noteClients:(id)sender {
  [self goTo:@"AI Clients"];
}

- (void)leaveNote {
  [_note removeFromSuperview];
  _note = nil;
  ((MVRoomView *)_room).note = nil;
}

- (MVToolsPane *)toolsPane {
  return _tools;
}

/// All a place's parent says comes by one word: each part has its own key.
- (void)showClients:(NSDictionary *)message {
  if (message[@"connect"]) return [_connect show:message[@"connect"]];
  if (message[@"apps"]) return [_tools showApps:message];
  if (!message[@"run"]) return [_clients show:message];
  [_tools heard:message[@"run"]];
  [_connect heard:message[@"run"]];
}

/// `⌘?`, from the first that answers, which is the hub, as its window's delegate.
- (void)openHelp:(id)sender {
  [self choosePlace:_places.lastObject];
}

/// A control where it stands, for a test: scrolled to, then clicked through the window's own hit testing, as a mouse's.
- (void)pokeClick:(NSString *)name {
  NSButton *button = MVFindControl(_window.contentView, name);
  MVEmit(MVClickControl(_window, button, name));
}

/// What a copy left: a window kept behind for a test copies to a board of its own, which only this can read.
- (void)pokeBoard {
  MVEmit(@{@"op": @"board", @"text": [MVPlaceBoard() stringForType:NSPasteboardTypeString] ?: @""});
}

/// A row of the sidebar by what it says, clicked the same way.
- (void)pokeRow:(NSString *)title {
  NSUInteger at = [[_list.rows valueForKey:@"title"] indexOfObject:MVWord(title)];
  if (at == NSNotFound) return MVEmit(@{@"op": @"clicked", @"name": title, @"found": @NO});
  MVRealClick(_window, [_list pointOfRow:at]);
  MVEmit(@{@"op": @"clicked", @"name": title, @"found": @YES});
}

@end
