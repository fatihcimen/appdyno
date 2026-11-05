// AI Clients and Help with no parent: what each real click asks of it, and what its answers show. A device run has the parent.
#import "Place.h"
#import "SelfTest.h"
#import "Words.h"

static NSMutableArray<NSDictionary *> *gAsked;

static NSDictionary *fixture(void) {
  return @{
    @"rows": @[
      @{@"name": @"One", @"state": @"connected", @"file": @"/x/one", @"lastSaid": @"2 minutes ago", @"check": @{@"en": @"Type `one`.", @"tr": @"`one` yazın."}},
      @{@"name": @"Two", @"state": @"added", @"file": @"/x/two"},
      @{@"name": @"Three", @"state": @"open", @"file": @"/x/three"},
      @{@"name": @"Four", @"state": @"refused", @"file": @"/x/four", @"why": @"not JSON"},
      @{@"name": @"Five", @"state": @"absent"},
      @{@"name": @"Six", @"state": @"browser"},
    ],
    @"browser": @[@"Six"],
    @"server": @{},
    @"notes": @[@{@"client": @"Six", @"kind": @"long", @"en": @"It has 120 seconds.", @"tr": @"120 saniyesi var."}],
  };
}

static NSString *wordsOf(MVHub *hub) {
  return [[hub.parts valueForKey:@"text"] componentsJoinedByString:@"|"];
}

static BOOL has(MVHub *hub, NSString *name) {
  return MVFindControl(hub.room.window.contentView, name) != nil;
}

/// A real click, and the one word it asked of the parent.
static NSDictionary *clicked(MVHub *hub, NSString *name) {
  [gAsked removeAllObjects];
  [hub pokeClick:name];
  MVPump(0.1);
  return gAsked.lastObject;
}

static void checkStates(MVHub *hub) {
  for (NSString *name in @[@"test:One", @"remove:One", @"test:Two", @"remove:Two", @"add:Three", @"test:Six"]) MVCheck([@"clients: a row offers " stringByAppendingString:name], has(hub, name), nil);
  for (NSString *name in @[@"add:One", @"add:Two", @"test:Three", @"remove:Three", @"add:Four", @"remove:Four", @"test:Four", @"add:Five", @"test:Five", @"add:Six", @"remove:Six"]) MVCheck([@"clients: a row does not offer " stringByAppendingString:name], !has(hub, name), nil);
  NSString *words = wordsOf(hub);
  for (NSString *said in @[@"Connected · last call 2 minutes ago", @"Added, restart it", @"Not added", @"Its settings file cannot be edited", @"not JSON", @"Runs in a browser: nothing to add here", @"Five"]) MVCheck([@"clients: says " stringByAppendingString:said], [words containsString:MVWord(said)], words);
}

static void checkChange(MVHub *hub) {
  MVCheck(@"clients: Add asks for the change first", [clicked(hub, @"add:Three")[@"do"] isEqual:@"preview"], nil);
  NSDictionary *preview = @{@"client": @"Three", @"remove": @NO, @"file": @"/x/three", @"did": @"added", @"backup": @YES, @"lines": @[@"+ the line"]};
  [hub showClients:@{@"preview": preview}];
  MVCheck(@"clients: the lines stand before anything is done", [wordsOf(hub) containsString:@"+ the line"] && has(hub, @"apply:Three"), nil);
  MVCheck(@"clients: Cancel asks nothing, and takes the lines away", clicked(hub, @"cancel:Three") == nil && !has(hub, @"apply:Three"), nil);
  clicked(hub, @"add:Three");
  [hub showClients:@{@"preview": preview}];
  NSDictionary *change = clicked(hub, @"apply:Three");
  MVCheck(@"clients: the second click makes the change", [change[@"do"] isEqual:@"change"] && [change[@"client"] isEqual:@"Three"] && ![change[@"remove"] boolValue], nil);
  NSMutableArray *rows = [fixture()[@"rows"] mutableCopy];
  rows[2] = @{@"name": @"Three", @"state": @"added", @"file": @"/x/three", @"undo": @YES};
  [hub showClients:@{@"rows": rows, @"browser": @[@"Six"], @"done": @{@"client": @"Three", @"did": @"added", @"backup": @"/x/three.backup"}}];
  MVCheck(@"clients: what was done says so, with a way back", has(hub, @"undo:Three") && [wordsOf(hub) containsString:@"/x/three.backup"], wordsOf(hub));
  MVCheck(@"clients: Undo asks for it", [clicked(hub, @"undo:Three")[@"do"] isEqual:@"undo"], nil);
  [hub showClients:fixture()];
  clicked(hub, @"remove:Two");
  [hub showClients:@{@"preview": @{@"client": @"Two", @"remove": @YES, @"file": @"/x/two", @"did": @"removed", @"lines": @[@"- the line"]}}];
  MVCheck(@"clients: Remove goes by the lines too", [clicked(hub, @"apply:Two")[@"remove"] boolValue], nil);
  [hub showClients:@{@"done": @{@"client": @"Two", @"did": @"removed"}}];
}

static void checkTest(MVHub *hub) {
  NSDictionary *test = clicked(hub, @"test:One");
  MVCheck(@"clients: Test asks for that client", [test[@"do"] isEqual:@"test"] && [test[@"client"] isEqual:@"One"], nil);
  NSButton *button = MVFindControl(hub.room.window.contentView, @"test:One");
  MVCheck(@"clients: a test under way says so and takes no second click", !button.enabled, nil);
  [hub showClients:@{@"tested": @{@"client": @"One", @"ok": @NO, @"said": @"It stopped before it answered.", @"next": @"Read what it said here, and run Doctor in Help.", @"tail": @"npm error boom"}}];
  NSString *words = wordsOf(hub);
  MVCheck(@"clients: a failed test says what it found and what to do next", [words containsString:MVWord(@"It stopped before it answered.")] && [words containsString:@"npm error boom"], words);
  button = MVFindControl(hub.room.window.contentView, @"test:Two");
  NSMutableArray *rows = [fixture()[@"rows"] mutableCopy];
  NSMutableDictionary *later = [rows[0] mutableCopy];
  later[@"lastSaid"] = @"3 minutes ago";
  rows[0] = later;
  [hub showClients:@{@"rows": rows, @"browser": @[@"Six"]}];
  MVCheck(@"clients: time going by draws no row again, and takes no button from a pointer", button.window != nil && [wordsOf(hub) containsString:MVWord(@"Connected · last call 3 minutes ago")], nil);
}

static void checkServer(MVHub *hub) {
  NSWindow *window = hub.room.window;
  MVCheck(@"server: its token stands hidden", ![wordsOf(hub) containsString:@"the-token"], nil);
  MVCheck(@"server: Show asks for the token", [clicked(hub, @"showToken")[@"do"] isEqual:@"token"], nil);
  [hub showClients:@{@"token": @"the-token"}];
  MVCheck(@"server: and shows it", [wordsOf(hub) containsString:@"the-token"], nil);
  MVCheck(@"server: Hide asks nothing, and hides it", clicked(hub, @"showToken") == nil && ![wordsOf(hub) containsString:@"the-token"], nil);
  MVCheck(@"server: Copy asks for it, and does not show it", [clicked(hub, @"copyToken")[@"do"] isEqual:@"copyToken"], nil);
  [hub showClients:@{@"copy": @"the-token", @"concealed": @YES}];
  MVCheck(@"server: a copied token is on the board, marked not to be kept", [[MVPlaceBoard() stringForType:NSPasteboardTypeString] isEqual:@"the-token"] && [MVPlaceBoard() stringForType:@"org.nspasteboard.ConcealedType"] != nil && ![wordsOf(hub) containsString:@"the-token"], nil);
  MVCheck(@"server: Start asks for it", [clicked(hub, @"serverPower")[@"do"] isEqual:@"start"], nil);
  [hub showClients:@{@"rows": fixture()[@"rows"], @"browser": @[@"Six"], @"server": @{@"address": @"http://127.0.0.1:1/mcp"}}];
  MVCheck(@"server: it says where it listens, in a window behind others too", [wordsOf(hub) containsString:MVWord(@"Listening on http://127.0.0.1:1/mcp")], wordsOf(hub));
  MVCheck(@"server: New Token asks for one", [clicked(hub, @"newToken")[@"do"] isEqual:@"renewToken"], nil);
  [hub pokeClick:@"copyAddress"];
  MVPump(0.1);
  MVCheck(@"server: Copy Address copies it", [[MVPlaceBoard() stringForType:NSPasteboardTypeString] isEqual:@"http://127.0.0.1:1/mcp"], nil);
  MVCheck(@"server: Stop asks for that", [clicked(hub, @"serverPower")[@"do"] isEqual:@"stop"], nil);
  [hub showClients:@{@"serverFailed": @"no port free"}];
  [hub showClients:fixture()];
  MVCheck(@"server: why it could not start outlasts the next look", [wordsOf(hub) containsString:@"no port free"], wordsOf(hub));
  MVCheck(@"server: and goes with the next try", [clicked(hub, @"serverPower")[@"do"] isEqual:@"start"], nil);
  [hub showClients:fixture()];
  MVCheck(@"server: nothing of it stands in a window that is gone", window != nil, nil);
}

static void checkHelp(MVHub *hub) {
  NSSplitViewItem *inspector = ((MVRoomView *)hub.room).slot.item;
  [hub pokeRow:@"Help"];
  MVPump(0.2);
  MVCheck(@"help: a real click on its row takes the room", [hub.placeShown isKindOfClass:MVHelpPane.class], nil);
  MVCheck(@"help: it has no Inspector beside it", inspector.collapsed, nil);
  MVHelpPane *help = (MVHelpPane *)hub.placeShown;
  [help fillDevice:@{@"name": @"A Phone, Blue"} app:@"Some, App"];
  for (int card = 0; card < 5; card++) {
    [hub pokeClick:[NSString stringWithFormat:@"copyPrompt:%d", card]];
    MVPump(0.1);
    NSString *copied = [MVPlaceBoard() stringForType:NSPasteboardTypeString];
    MVCheck([NSString stringWithFormat:@"help: card %d copies its prompt, with the device in it", card], [copied containsString:@"A Phone, Blue"], copied);
    if (card) MVCheck([NSString stringWithFormat:@"help: card %d names the app too", card], [copied containsString:@"Some, App"], copied);
  }
  [help fillDevice:nil app:nil];
  [hub pokeClick:@"copyPrompt:2"];
  MVPump(0.1);
  MVCheck(@"help: with no device a prompt still reads", [[MVPlaceBoard() stringForType:NSPasteboardTypeString] containsString:MVWord(@"of my app")], nil);
  [hub showClients:fixture()];
  NSString *words = wordsOf(hub);
  MVCheck(@"help: a client's own note stands on the cards it touches", [words containsString:MVSaid(@{@"en": @"It has 120 seconds.", @"tr": @"120 saniyesi var."})], words);
  for (NSString *word in @[@"could not judge", @"noisy", @"mirrored", @"modelled"]) MVCheck([@"help: says what this means: " stringByAppendingString:word], [words containsString:MVWord(word)], nil);
  MVCheck(@"help: Run Doctor asks for it", [clicked(hub, @"runDoctor")[@"do"] isEqual:@"doctor"], nil);
  [hub showClients:@{@"doctor": @[@{@"name": @"adb", @"ok": @NO, @"detail": @"not found", @"fix": @"get it"}, @{@"name": @"node", @"ok": @YES, @"detail": @"22"}]}];
  MVPump(0.1);
  MVCheck(@"help: its checks stand there, with what to do", [wordsOf(hub) containsString:@"get it"], nil);
  NSMenu *bar = MVHubMenu();
  NSMenuItem *item = [bar.itemArray.lastObject.submenu itemAtIndex:0];
  MVCheck(@"help: command-? opens it", [item.keyEquivalent isEqual:@"?"] && item.action == @selector(openHelp:), nil);
}

static void checkSidebar(MVHub *hub) {
  NSSplitViewItem *inspector = ((MVRoomView *)hub.room).slot.item;
  NSDictionary *off = @{@"id": @"s", @"serial": @"s", @"kind": @"simulator", @"state": @"stopped", @"name": @"A Simulator"};
  NSDictionary *up = @{@"id": @"u", @"serial": @"u", @"kind": @"simulator", @"state": @"running", @"name": @"Another Simulator"};
  [hub show:@{@"devices": @[off, up]}];
  MVPump(0.3);
  MVCheck(@"sidebar: a list changing behind a place leaves it standing", hub.placeShown != nil && hub.chosen == nil, nil);
  [hub pokeRow:@"Another Simulator"];
  MVPump(0.3);
  MVCheck(@"sidebar: a device takes the room back, with its Inspector", hub.placeShown == nil && [hub.chosen isEqual:@"u"] && !inspector.collapsed, hub.chosen);
}

void MVCheckPlaces(void) {
  MVPlaceBehind(YES);
  gAsked = [NSMutableArray array];
  MVTapAsks(^(NSDictionary *message) {
    if (![message[@"do"] isEqual:@"list"]) [gAsked addObject:message];
  });
  MVHub *hub = [[MVHub alloc] initWithShow:MVShowBehind poses:NO];
  [hub show:@{@"devices": @[]}];
  MVPump(0.2);
  [hub pokeRow:@"AI Clients"];
  MVPump(0.2);
  MVCheck(@"clients: a real click on its row takes the room", [hub.placeShown isKindOfClass:MVClientsPane.class], nil);
  [hub showClients:fixture()];
  MVPump(0.1);
  checkStates(hub);
  checkChange(hub);
  checkTest(hub);
  checkServer(hub);
  checkHelp(hub);
  checkSidebar(hub);
  MVTapAsks(nil);
}
