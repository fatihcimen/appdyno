// The hub's two places: how a person comes to AI Clients and Help, and what they are told as they do.
#import "HubParts.h"
#import "Place.h"
#import "Words.h"

@implementation MVHub (Places)

- (void)addOwnPlaces {
  _clients = [MVClientsPane new];
  _help = [MVHelpPane new];
  __weak MVHelpPane *help = _help;
  _clients.onNotes = ^(NSArray *notes) {
    [help showNotes:notes];
  };
  _clients.onDoctor = ^(NSArray *checks) {
    [help showDoctor:checks];
  };
  NSArray *own = @[@[@"AI Clients", @"sparkles", _clients], @[@"Help", @"questionmark.circle", _help]];
  for (NSArray *one in own) {
    MVPlace *place = [MVPlace new];
    place.title = MVWord(one[0]);
    place.symbol = one[1];
    place.view = one[2];
    [self addPlace:place];
  }
}

- (void)showClients:(NSDictionary *)message {
  [_clients show:message];
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
