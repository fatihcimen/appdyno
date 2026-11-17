// The first launch's welcome: kept behind with its hub, its three steps each a real click that takes the hub where it says,
// and, for a person who asked for less motion or with no movie, all of it at once. In Turkish too.
#import "HubParts.h"
#import "SelfTest.h"
#import "Words.h"

/// A step's button by a real click; what the hub shows after it, and whether the welcome closed.
static NSView *_Nullable clickStep(MVHub *hub, NSString *name) {
  [hub openWelcome:nil];
  MVPump(0.2);
  NSWindow *welcome = hub.welcomeWindow;
  NSDictionary *clicked = MVClickControl(welcome, MVFindControl(welcome.contentView, name), name);
  MVPump(0.3);
  MVCheck([NSString stringWithFormat:@"welcome: %@ is a real click on its button, which closes the welcome", name], [clicked[@"isIt"] boolValue] && !welcome.visible, clicked.description);
  return hub.placeShown;
}

void MVCheckWelcome(void) {
  MVPlaceBehind(YES);
  MVHub *hub = [[MVHub alloc] initWithShow:MVShowBehind poses:NO];
  [hub show:@{@"devices": @[]}];
  MVPump(0.2);
  [hub openWelcome:nil];
  MVPump(0.2);
  MVOffscreenWindow *welcome = (MVOffscreenWindow *)hub.welcomeWindow;
  MVCheck(@"welcome: a hub kept behind keeps its welcome behind too", [welcome isKindOfClass:MVOffscreenWindow.class] && welcome.offscreen, nil);
  NSArray<NSString *> *steps = @[@"welcomeClients", @"welcomeDevice", @"welcomePhone"];
  NSMutableArray<NSString *> *shown = [NSMutableArray array];
  for (NSString *name in steps)
    if (!MVFindControl(welcome.contentView, name).isHiddenOrHasHiddenAncestor) [shown addObject:name];
  // the self test has no movie: the dragon's moment has nothing to wait for
  MVCheck(@"welcome: with no movie its three steps stand at once", [shown isEqual:steps], shown.description);
  [welcome close];
  MVPump(0.2);
  MVCheck(@"welcome: AI Clients takes the hub to AI Clients", [clickStep(hub, @"welcomeClients") isKindOfClass:MVClientsPane.class], nil);
  MVCheck(@"welcome: Connect a Phone takes the hub to Connect a Phone", [clickStep(hub, @"welcomePhone") isKindOfClass:MVConnectPane.class], nil);
  NSDictionary *kinds = @{@"models": @[@{@"name": @"iPhone 17", @"id": @"m"}],
                          @"systems": @[@{@"name": @"iOS 27", @"id": @"s"}]};
  [hub show:@{@"devices": @[],
              @"choices": @{@"simulator": kinds}}];
  MVPump(0.2);
  clickStep(hub, @"welcomeDevice");
  NSWindow *sheet = hub.room.window.attachedSheet;
  MVCheck(@"welcome: where Xcode can make one, it asks for a new simulator", sheet != nil, nil);
  if (sheet) [hub.room.window endSheet:sheet];
  MVTestTurkish(YES);
  [hub openWelcome:nil];
  MVPump(0.2);
  MVCheck(@"welcome: says its word in the Mac's language", [hub.welcomeWindow.title isEqual:@"Hoş geldiniz"], hub.welcomeWindow.title);
  [hub.welcomeWindow close];
  MVTestTurkish(NO);
  MVPump(0.2);
}
