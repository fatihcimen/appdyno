// Connect a Phone with no parent: what a phone cannot stage is stood in for by what the parent would say of it,
// and every control is pressed by a real click through the window's hit testing. A device run has the parent.
#import "HubParts.h"
#import "Place.h"
#import "SelfTest.h"
#import "Words.h"

static NSMutableArray<NSDictionary *> *gAsked;

static NSString *wordsOf(MVHub *hub) {
  return [[hub.parts valueForKey:@"text"] componentsJoinedByString:@"|"];
}

static BOOL says(MVHub *hub, NSString *english) {
  return [wordsOf(hub) containsString:MVWord(english)];
}

static NSDictionary *clicked(MVHub *hub, NSString *name) {
  [gAsked removeAllObjects];
  [hub pokeClick:name];
  MVPump(0.1);
  return gAsked.lastObject;
}

static NSDictionary *step(NSString *id, BOOL done, BOOL sees) {
  return @{@"id": id,
           @"done": @(done),
           @"sees": @(sees)};
}

static NSDictionary *android(NSString *maker, BOOL heard, BOOL allowed) {
  NSMutableDictionary *guide = [@{@"hand": @"android",
                                  @"maker": maker,
                                  @"ready": @(allowed),
                                  @"name": @"Test Phone",
                                  @"steps": @[step(@"developer-options", heard, NO), step(@"usb-debugging", heard, NO), step(@"allow", allowed, YES)]} mutableCopy];
  if (heard) guide[@"serial"] = @"R5C";
  return guide;
}

static void look(MVHub *hub, NSDictionary *guide) {
  [hub showClients:@{@"connect": guide}];
  MVPump(0.1);
}

static void checkAndroid(MVHub *hub) {
  look(hub, @{@"steps": @[],
              @"ready": @NO});
  MVCheck(@"connect: with nothing on USB it says the cable plainly", says(hub, @"Plug in your phone") && says(hub, @"Nothing shows on this Mac yet. A cable that only charges shows nothing, so try another one."), wordsOf(hub));
  look(hub, android(@"samsung", NO, NO));
  MVCheck(@"connect: a Samsung is told where its Build number is", says(hub, @"Settings, About phone, Software information, Build number") && says(hub, @"Step 1 of 3"), wordsOf(hub));
  look(hub, android(@"google", NO, NO));
  MVCheck(@"connect: a Pixel is told its own way", says(hub, @"Settings, About phone, Build number"), wordsOf(hub));
  look(hub, android(@"other", NO, NO));
  MVCheck(@"connect: any other phone is told where it may be", says(hub, @"Settings, About phone, Build number. On some phones it is under Software information."), wordsOf(hub));
  look(hub, android(@"xiaomi", NO, NO));
  MVCheck(@"connect: a Xiaomi taps another line", says(hub, @"Tap OS version seven times.") && says(hub, @"Settings, About phone, OS version"), wordsOf(hub));
  MVCheck(@"connect: Next takes no word to the parent", clicked(hub, @"stepNext") == nil, nil);
  MVCheck(@"connect: a step the Mac cannot see moves on by a person's word", says(hub, @"Find it in Developer options, and turn it on.") && says(hub, @"Step 2 of 3"), wordsOf(hub));
  [hub pokeClick:@"stepBack"];
  MVPump(0.1);
  MVCheck(@"connect: and Back takes it back", says(hub, @"Tap OS version seven times."), wordsOf(hub));
  [hub pokeClick:@"stepNext"];
  MVPump(0.1);
  look(hub, android(@"xiaomi", YES, NO));
  MVCheck(@"connect: when adb hears of it the step moves on by itself", says(hub, @"On the phone, tick Always allow, then tap Allow.") && says(hub, @"Step 3 of 3"), wordsOf(hub));
  MVCheck(@"connect: a dark phone is said, not guessed", says(hub, @"If the screen is dark, wake and unlock it: this Mac cannot see that, and the question waits there."), nil);
  MVCheck(@"connect: a step the Mac sees has no Next", MVFindControl(hub.room.window.contentView, @"stepNext").hidden, nil);
  MVCheck(@"connect: the phone's current step only", !says(hub, @"Tap OS version seven times."), wordsOf(hub));
}

static void checkXiaomiSwitches(MVHub *hub) {
  NSMutableDictionary *guide = [android(@"xiaomi", YES, YES) mutableCopy];
  guide[@"steps"] = [guide[@"steps"] arrayByAddingObjectsFromArray:@[step(@"xiaomi-security", NO, NO), step(@"xiaomi-install", NO, NO)]];
  look(hub, guide);
  MVCheck(@"connect: a Xiaomi's first switch", says(hub, @"Turn on USB debugging (Security settings)"), wordsOf(hub));
  [hub pokeClick:@"stepNext"];
  MVPump(0.1);
  MVCheck(@"connect: and its second", says(hub, @"Turn on Install via USB"), wordsOf(hub));
}

static void checkNeeds(MVHub *hub) {
  NSMutableDictionary *locked = [android(@"samsung", YES, YES) mutableCopy];
  locked[@"ready"] = @NO;
  locked[@"need"] = @"locked";
  locked[@"needWords"] = @{@"title": @"The device is locked", @"fix": @"Unlock it. The picture goes on; input stops where it asks for a passcode."};
  look(hub, locked);
  MVCheck(@"connect: a lock read off the phone is said", says(hub, @"The device is locked"), wordsOf(hub));
  NSMutableDictionary *dark = [locked mutableCopy];
  dark[@"need"] = @"asleep";
  dark[@"needWords"] = @{@"title": @"The screen is off", @"fix": @"Wake the device. The picture comes back by itself."};
  look(hub, dark);
  MVCheck(@"connect: so is a dark screen", says(hub, @"The screen is off"), wordsOf(hub));
}

static void checkIphone(MVHub *hub) {
  NSDictionary *trust = @{@"hand": @"ios",
                          @"maker": @"apple",
                          @"ready": @NO,
                          @"steps": @[step(@"trust", NO, YES), step(@"developer-mode", NO, YES)],
                          @"runner": @[@{@"name": @"xcode",
                                         @"ok": @YES,
                                         @"detail": @"Xcode 27"}]};
  look(hub, trust);
  MVCheck(@"connect: an iPhone is asked for Trust and its passcode", says(hub, @"Unlock the phone, tap Trust, then enter your passcode."), wordsOf(hub));
  MVCheck(@"connect: and told what a runner needs", says(hub, @"To drive an iPhone by its screen, appdyno puts a small runner on it. That takes Xcode and a signing team.") && [wordsOf(hub) containsString:@"Xcode 27"], wordsOf(hub));
  MVAccentButton *runner = (MVAccentButton *)MVFindControl(hub.room.window.contentView, @"run:runner");
  MVCheck(@"connect: Build Runner has the colour where nothing else asks for it", !runner.quiet, nil);
  NSDictionary *build = clicked(hub, @"run:runner");
  MVCheck(@"connect: and can build one from here", [build[@"do"] isEqual:@"run"] && [build[@"name"] isEqual:@"runner"], nil);
  look(hub, @{@"hand": @"ios",
              @"maker": @"apple",
              @"ready": @NO,
              @"steps": @[step(@"trust", YES, YES), step(@"developer-mode", NO, YES)]});
  MVCheck(@"connect: Developer Mode says first that the phone restarts", says(hub, @"Your phone restarts when you turn this on.") && says(hub, @"Settings, Privacy & Security, Developer Mode."), wordsOf(hub));
}

static NSTextField *wifiField(MVHub *hub, NSString *name) {
  NSMutableArray<NSView *> *left = [NSMutableArray arrayWithObject:hub.room.window.contentView];
  for (NSUInteger at = 0; at < left.count; at++) {
    if ([left[at].identifier isEqual:name]) return (NSTextField *)left[at];
    [left addObjectsFromArray:left[at].subviews];
  }
  return nil;
}

static void checkWifi(MVHub *hub) {
  NSDictionary *phone = @{@"hand": @"ios",
                          @"maker": @"apple",
                          @"ready": @YES,
                          @"serial": @"U",
                          @"steps": @[],
                          @"wifi": @{@"way": @"cable", @"paired": @NO}};
  look(hub, phone);
  MVCheck(@"wi-fi: an iPhone on its cable is told to pair there, once", says(hub, @"Pair this iPhone once, while it is on this cable and unlocked. After that it shows here by Wi-Fi, on this Mac's network."), wordsOf(hub));
  NSDictionary *asked = clicked(hub, @"pairWifi");
  MVCheck(@"wi-fi: and Pair runs the command for that phone", [asked[@"do"] isEqual:@"run"] && [asked[@"name"] isEqual:@"pair"] && [asked[@"device"] isEqual:@"U"], nil);
  [hub showClients:@{@"run": @{@"name": @"pair", @"text": @"Tap Trust on the phone.\n"}}];
  MVPump(0.1);
  MVCheck(@"wi-fi: what the phone wants of a person is said, in their language", says(hub, @"Tap Trust on the phone."), wordsOf(hub));
  look(hub, @{@"hand": @"ios",
              @"maker": @"apple",
              @"ready": @YES,
              @"serial": @"U",
              @"steps": @[],
              @"wifi": @{@"way": @"cable", @"paired": @YES}});
  NSDictionary *forget = clicked(hub, @"forgetWifi");
  MVCheck(@"wi-fi: a paired iPhone can be forgotten here", says(hub, @"Paired for Wi-Fi. Unplug it, and it stays in the list while it is on this Mac's network.") && [forget[@"name"] isEqual:@"forget"], wordsOf(hub));
  look(hub, @{@"hand": @"android",
              @"maker": @"samsung",
              @"ready": @YES,
              @"serial": @"W1",
              @"steps": @[],
              @"wifi": @{@"way": @"code", @"paired": @NO}});
  MVCheck(@"wi-fi: an Android phone is told where its code is", says(hub, @"On the phone: Settings, Developer options, Wireless debugging, Pair device with pairing code. Type here what it shows."), wordsOf(hub));
  MVCheck(@"wi-fi: and nothing goes without one", clicked(hub, @"pairWifi") == nil && says(hub, @"Type the address and the six digits the phone shows."), wordsOf(hub));
  wifiField(hub, @"wifiAddress").stringValue = @"10.0.0.2:37000";
  wifiField(hub, @"wifiCode").stringValue = @"123456";
  NSDictionary *byCode = clicked(hub, @"pairWifi");
  MVCheck(@"wi-fi: what it shows goes to the command as typed", [byCode[@"address"] isEqual:@"10.0.0.2:37000"] && [byCode[@"code"] isEqual:@"123456"], nil);
  look(hub, @{@"steps": @[],
              @"ready": @NO});
  MVCheck(@"wi-fi: with no phone the card goes", !says(hub, @"Without a Cable"), wordsOf(hub));
}

static void checkAdb(MVHub *hub) {
  NSDictionary *guide = @{@"hand": @"android",
                          @"maker": @"samsung",
                          @"ready": @NO,
                          @"terms": @"https://terms.example",
                          @"steps": @[step(@"get-adb", NO, YES), step(@"developer-options", NO, NO)]};
  look(hub, guide);
  MVCheck(@"adb: Google's terms come first", says(hub, @"This Mac talks to an Android phone through adb, which comes from Google under its own terms."), wordsOf(hub));
  [hub pokeClick:@"terms"];
  MVPump(0.1);
  MVCheck(@"adb: its terms open from a click, and no page opens from a test", [MVLastOpened() isEqual:@"https://terms.example"], MVLastOpened());
  NSDictionary *get = clicked(hub, @"getAdb");
  MVCheck(@"adb: Accept runs it, and only then", [get[@"do"] isEqual:@"run"] && [get[@"name"] isEqual:@"adb"], nil);
  [hub showClients:@{@"run": @{@"name": @"adb", @"started": @YES, @"command": @"appdyno tools install adb --accept-license"}}];
  MVPump(0.1);
  MVCheck(@"adb: it says so while it comes, and takes no second click", !MVFindControl(hub.room.window.contentView, @"getAdb").enabled, nil);
  [hub showClients:@{@"run": @{@"name": @"adb", @"text": @"no network"}}];
  [gAsked removeAllObjects];
  [hub showClients:@{@"run": @{@"name": @"adb", @"code": @1}}];
  MVPump(0.1);
  MVCheck(@"adb: a failure is a sentence, and its log stays out of sight", says(hub, @"Getting adb failed.") && ![wordsOf(hub) containsString:@"no network"], wordsOf(hub));
  [hub pokeClick:@"adbDetails"];
  MVPump(0.1);
  MVCheck(@"adb: until a person asks", [wordsOf(hub) containsString:@"no network"], wordsOf(hub));
  MVCheck(@"adb: and looks again", [gAsked.lastObject[@"fresh"] boolValue], nil);
}

static void checkDone(MVHub *hub) {
  NSDictionary *phone = @{@"id": @"R5C", @"serial": @"R5C", @"kind": @"phone", @"state": @"running", @"name": @"Test Phone"};
  look(hub, android(@"samsung", YES, NO));
  [hub show:@{@"devices": @[phone]}];
  MVPump(0.1);
  MVCheck(@"done: a phone is not opened for being listed", hub.chosen == nil && hub.placeShown != nil, hub.chosen);
  look(hub, android(@"samsung", YES, YES));
  MVPump(0.3);
  MVCheck(@"done: a phone that got ready here opens by itself", [hub.chosen isEqual:@"R5C"] && hub.placeShown == nil, hub.chosen);
  MVCheck(@"done: with one sentence on what to try", says(hub, @"Ask your AI app what is on its screen."), wordsOf(hub));
  NSView *stage = [MVRootView new];
  [hub.room addSubview:stage];
  [hub.room layoutSubtreeIfNeeded];
  NSView *note = ((MVRoomView *)hub.room).note;
  MVCheck(@"done: a stage that comes after it stays under the sentence", hub.room.subviews.lastObject == note, nil);
  MVCheck(@"done: and makes room for it: a picture is never covered", NSMinY(note.frame) >= NSMaxY(stage.frame) && note.frame.size.height > 0, NSStringFromRect(stage.frame));
  [stage removeFromSuperview];
  [hub pokeClick:@"noteClose"];
  MVPump(0.2);
  MVCheck(@"done: Close takes the sentence away, and leaves the device", !says(hub, @"Ask your AI app what is on its screen.") && [hub.chosen isEqual:@"R5C"], wordsOf(hub));
  MVPokeRow(hub, @"Connect a Phone");
  MVPump(0.3);
  look(hub, android(@"samsung", YES, YES));
  MVCheck(@"done: a phone ready all along waits to be chosen", hub.chosen == nil && hub.placeShown != nil, hub.chosen);
  [hub pokeClick:@"openPhone"];
  MVPump(0.3);
  MVCheck(@"done: and Open opens it", [hub.chosen isEqual:@"R5C"] && hub.placeShown == nil, hub.chosen);
  [hub pokeClick:@"noteClients"];
  MVPump(0.3);
  MVCheck(@"done: AI Clients is one step away", [hub.placeShown isKindOfClass:MVClientsPane.class], nil);
  MVPokeRow(hub, @"Connect a Phone");
  MVPump(0.3);
  [hub pokeClick:@"toClients"];
  MVPump(0.3);
  MVCheck(@"done: from the guide too", [hub.placeShown isKindOfClass:MVClientsPane.class], nil);
  [hub show:@{@"devices": @[]}];
}

/// Only at the guide, with nothing on the stage; and the first of two.
static void checkLimits(MVHub *hub) {
  NSDictionary *one = @{@"id": @"R5C", @"serial": @"R5C", @"kind": @"phone", @"state": @"running", @"name": @"Test Phone"};
  NSDictionary *two = @{@"id": @"R6D", @"serial": @"R6D", @"kind": @"phone", @"state": @"running", @"name": @"Other Phone"};
  [hub show:@{@"devices": @[one, two]}];
  MVPokeRow(hub, @"Connect a Phone");
  MVPump(0.3);
  look(hub, android(@"samsung", YES, NO));
  MVPokeRow(hub, @"Tools");
  MVPump(0.3);
  look(hub, android(@"samsung", YES, YES));
  MVPump(0.2);
  MVCheck(@"limits: a phone that gets ready while a person is elsewhere moves nothing", hub.chosen == nil && [hub.placeShown isKindOfClass:MVToolsPane.class], hub.chosen);
  MVPokeRow(hub, @"Connect a Phone");
  MVPump(0.3);
  NSMutableDictionary *second = [android(@"samsung", YES, NO) mutableCopy];
  second[@"serial"] = @"R6D";
  look(hub, android(@"samsung", YES, NO));
  look(hub, second);
  look(hub, android(@"samsung", YES, YES));
  MVPump(0.3);
  MVCheck(@"limits: of two, the first opens", [hub.chosen isEqual:@"R5C"], hub.chosen);
  NSMutableDictionary *ready = [android(@"samsung", YES, YES) mutableCopy];
  ready[@"serial"] = @"R6D";
  look(hub, ready);
  MVPump(0.3);
  MVCheck(@"limits: the second only gets its row", [hub.chosen isEqual:@"R5C"], hub.chosen);
  [hub show:@{@"devices": @[]}];
}

/// A picture moves for a few beats, and not at all for a person who asked for less motion.
static void checkPictureMoves(MVHub *hub) {
  MVStepPicture *picture = [[MVStepPicture alloc] initWithFrame:NSMakeRect(0, 0, 216, 196)];
  [hub.room addSubview:picture];
  MVHoldStill(YES);
  picture.step = @"developer-mode";
  [picture display];
  MVPump(0.2);
  MVCheck(@"motion: with Reduce Motion a step stands still", picture.layer.sublayers.lastObject.sublayers.count == 0, nil);
  MVHoldStill(NO);
  picture.step = @"usb-debugging";
  [picture display];
  MVPump(0.2);
  MVCheck(@"motion: else its switch slides", picture.layer.sublayers.lastObject.sublayers.count > 0, nil);
  [picture removeFromSuperview];
}

/// It goes by itself too.
static void checkNoteLeaves(MVHub *hub) {
  NSDictionary *one = @{@"id": @"R5C", @"serial": @"R5C", @"kind": @"phone", @"state": @"running", @"name": @"Test Phone"};
  [hub show:@{@"devices": @[one]}];
  MVPokeRow(hub, @"Connect a Phone");
  MVPump(0.3);
  look(hub, android(@"samsung", YES, NO));
  look(hub, android(@"samsung", YES, YES));
  MVPump(0.3);
  MVCheck(@"done: the sentence stands a while", says(hub, @"Ask your AI app what is on its screen."), wordsOf(hub));
  MVPump(12.2);
  MVCheck(@"done: and goes by itself", !says(hub, @"Ask your AI app what is on its screen.") && ((MVRoomView *)hub.room).note == nil, wordsOf(hub));
  [hub show:@{@"devices": @[]}];
}

/// Where each field and menu of a view ends on the right, in its window.
static void addEdges(NSView *view, NSMutableSet<NSNumber *> *edges) {
  BOOL field = [view isKindOfClass:NSTextField.class] && ((NSTextField *)view).editable;
  if (field || [view isKindOfClass:NSPopUpButton.class]) [edges addObject:@(round(NSMaxX([view convertRect:view.bounds toView:nil])))];
  for (NSView *sub in view.subviews) addEdges(sub, edges);
}

static NSView *viewNamed(NSView *view, NSString *name) {
  if ([view.identifier isEqual:name]) return view;
  for (NSView *sub in view.subviews)
    if (viewNamed(sub, name)) return viewNamed(sub, name);
  return nil;
}

static void checkWays(MVHub *hub) {
  NSDictionary *kinds = @{@"models": @[@{@"name": @"iPhone 17 Pro Max with a long name", @"id": @"m"}],
                          @"systems": @[@{@"name": @"iOS 27", @"id": @"s"}]};
  NSDictionary *choices = @{@"simulator": kinds, @"emulator": kinds};
  [hub show:@{@"devices": @[],
              @"choices": choices}];
  MVPokeRow(hub, @"Connect a Phone");
  MVPump(0.2);
  look(hub, @{@"steps": @[],
              @"ready": @NO});
  [hub pokeClick:@"startClients"];
  MVPump(0.3);
  MVCheck(@"started: Open goes to AI Clients", [hub.placeShown isKindOfClass:MVClientsPane.class], nil);
  MVPokeRow(hub, @"Connect a Phone");
  MVPump(0.3);
  [hub pokeClick:@"startHelp"];
  MVPump(0.3);
  MVCheck(@"started: and to Help", [hub.placeShown isKindOfClass:MVHelpPane.class], nil);
  MVPokeRow(hub, @"Connect a Phone");
  MVPump(0.3);
  look(hub, @{@"steps": @[],
              @"ready": @NO,
              @"client": @YES,
              @"prompt": @YES});
  NSWindow *window = hub.room.window;
  [hub pokeClick:@"newSimulator"];
  MVPump(0.3);
  MVCheck(@"started: New Simulator asks what to make", window.attachedSheet != nil, nil);
  NSMutableSet<NSNumber *> *edges = [NSMutableSet set];
  [window.attachedSheet.contentView layoutSubtreeIfNeeded];
  addEdges(window.attachedSheet.contentView, edges);
  MVCheck(@"started: its name, model and system end on one edge", edges.count == 1, edges.description);
  if (window.attachedSheet) [window endSheet:window.attachedSheet];
  MVPump(0.3);
  [hub pokeClick:@"newEmulator"];
  MVPump(0.3);
  MVCheck(@"started: and so does New Emulator", window.attachedSheet != nil, nil);
  if (window.attachedSheet) [window endSheet:window.attachedSheet];
  MVPump(0.3);
  // under a device allow list Create was refused, and the reason went to a line behind the sheet
  NSString *why = @"The hub was started with a list of allowed devices, so it makes no new one: start it without --allow-devices to make one.";
  [hub show:@{@"devices": @[],
              @"choices": @{@"simulator": [kinds dictionaryWithValuesForKeys:@[@"models", @"systems"]], @"emulator": @{@"models": kinds[@"models"], @"systems": kinds[@"systems"], @"refused": why}}}];
  [hub pokeClick:@"newEmulator"];
  MVPump(0.3);
  NSTextField *refused = (NSTextField *)viewNamed(window.attachedSheet.contentView, @"newRefused");
  NSButton *create = (NSButton *)MVFindControl(window.attachedSheet.contentView, @"create");
  MVCheck(@"started: a sheet that can make none says why, whole, and cannot be sent", [refused.stringValue isEqual:MVWord(why)] && !refused.hidden && NSHeight(refused.frame) > 20 && !create.enabled, refused.stringValue);
  if (window.attachedSheet) [window endSheet:window.attachedSheet];
  MVPump(0.3);
}

/// A phone's row said its model's code and the name it is sold as beneath: 25078RA3EY over REDMI 15C.
static void checkPhoneName(void) {
  MVRow *phone = MVDeviceRow(@{@"id": @"X", @"kind": @"phone", @"state": @"running", @"name": @"REDMI 15C", @"model": @"25078RA3EY"});
  MVRow *sim = MVDeviceRow(@{@"id": @"Y", @"kind": @"simulator", @"state": @"running", @"name": @"Test Sim", @"model": @"iPhone 17 Pro"});
  MVCheck(@"rows: a phone goes by what it is sold as, its model's code beneath", [phone.title isEqual:@"REDMI 15C"] && [phone.detail containsString:@"25078RA3EY"], phone.title);
  MVCheck(@"rows: a simulator by its model, what this Mac calls it beneath", [sim.title isEqual:@"iPhone 17 Pro"] && [sim.detail containsString:@"Test Sim"], sim.title);
}

static void checkNeedsYou(MVHub *hub) {
  NSDictionary *held = @{@"id": @"H", @"serial": @"H", @"kind": @"phone", @"state": @"running", @"name": @"Held Phone", @"need": @"not-trusted"};
  [hub show:@{@"devices": @[held]}];
  MVPokeRow(hub, @"Tools");
  MVPump(0.2);
  MVPokeRow(hub, @"Held Phone");
  MVPump(0.2);
  MVCheck(@"connect: a phone under Needs You opens on its step, and starts no stream", [hub.placeShown isKindOfClass:MVConnectPane.class] && hub.chosen == nil, hub.chosen);
  [hub show:@{@"devices": @[]}];
}

static void checkWords(void) {
  MVCheck(@"words: a step's count keeps each number in its place", [MVInTurkish(@"Step 1 of 4") isEqual:@"Adım 1 / 4"], MVInTurkish(@"Step 1 of 4"));
  MVCheck(@"words: and so does a duration", [MVInTurkish(@"2 min 5 s") isEqual:@"2 dk 5 sn"], MVInTurkish(@"2 min 5 s"));
  MVCheck(@"words: and a count of flows, the other way round", [MVInTurkish(@"2 of 3 flows passed.") isEqual:@"3 akıştan 2 tanesi geçti."], MVInTurkish(@"2 of 3 flows passed."));
}

void MVCheckConnect(void) {
  checkWords();
  MVPlaceBehind(YES);
  gAsked = [NSMutableArray array];
  MVTapAsks(^(NSDictionary *message) {
    NSString *what = message[@"do"];
    if (![what isEqual:@"list"] && ![what isEqual:@"apps"] && !([what isEqual:@"connect"] && ![message[@"fresh"] boolValue])) [gAsked addObject:message];
  });
  MVHub *hub = [[MVHub alloc] initWithShow:MVShowBehind poses:NO];
  [hub show:@{@"devices": @[]}];
  MVPump(0.2);
  MVCheck(@"connect: it stands where the hub has nothing to show", [hub.placeShown isKindOfClass:MVConnectPane.class], nil);
  checkAndroid(hub);
  checkXiaomiSwitches(hub);
  checkNeeds(hub);
  checkIphone(hub);
  checkWifi(hub);
  checkAdb(hub);
  checkDone(hub);
  checkLimits(hub);
  checkNoteLeaves(hub);
  checkPictureMoves(hub);
  checkWays(hub);
  checkNeedsYou(hub);
  checkPhoneName();
  MVPokeRow(hub, @"Connect a Phone");
  MVPump(0.2);
  MVCheck(@"connect: it stays reachable later", [hub.placeShown isKindOfClass:MVConnectPane.class], nil);
  MVCheckTools(hub);
  NSDictionary *up = @{@"id": @"u", @"serial": @"u", @"kind": @"simulator", @"state": @"running", @"name": @"Another Simulator"};
  [hub show:@{@"devices": @[up]}];
  MVPump(0.2);
  MVCheck(@"connect: a person's place stays while a simulator comes up", hub.placeShown != nil, nil);
  MVHub *fresh = [[MVHub alloc] initWithShow:MVShowBehind poses:NO];
  [fresh show:@{@"devices": @[]}];
  MVPump(0.1);
  [fresh show:@{@"devices": @[up]}];
  MVPump(0.2);
  MVCheck(@"connect: where it stood by itself, a simulator that comes up takes the room", fresh.placeShown == nil && [fresh.chosen isEqual:@"u"], fresh.chosen);
  MVTapAsks(nil);
}
