// Connect a Phone and Tools with no parent: what a phone cannot stage is stood in for by what the parent would say of it,
// and every control is pressed by a real click through the window's hit testing. A device run has the parent.
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
  return @{@"id": id, @"done": @(done), @"sees": @(sees)};
}

static NSDictionary *android(NSString *maker, BOOL heard, BOOL allowed) {
  NSMutableDictionary *guide = [@{@"hand": @"android", @"maker": maker, @"ready": @(allowed), @"name": @"Test Phone", @"steps": @[step(@"developer-options", heard, NO), step(@"usb-debugging", heard, NO), step(@"allow", allowed, YES)]} mutableCopy];
  if (heard) guide[@"serial"] = @"R5C";
  return guide;
}

static void look(MVHub *hub, NSDictionary *guide) {
  [hub showClients:@{@"connect": guide}];
  MVPump(0.1);
}

static void checkAndroid(MVHub *hub) {
  look(hub, @{@"steps": @[], @"ready": @NO});
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
  NSDictionary *trust = @{@"hand": @"ios", @"maker": @"apple", @"ready": @NO, @"steps": @[step(@"trust", NO, YES), step(@"developer-mode", NO, YES)], @"runner": @[@{@"name": @"xcode", @"ok": @YES, @"detail": @"Xcode 27"}]};
  look(hub, trust);
  MVCheck(@"connect: an iPhone is asked for Trust and its passcode", says(hub, @"Unlock the phone, tap Trust, then enter your passcode."), wordsOf(hub));
  MVCheck(@"connect: and told what a runner needs", says(hub, @"To drive an iPhone by its screen, appdyno puts a small runner on it. That takes Xcode and a signing team.") && [wordsOf(hub) containsString:@"Xcode 27"], wordsOf(hub));
  NSDictionary *build = clicked(hub, @"run:runner");
  MVCheck(@"connect: and can build one from here", [build[@"do"] isEqual:@"run"] && [build[@"name"] isEqual:@"runner"], nil);
  look(hub, @{@"hand": @"ios", @"maker": @"apple", @"ready": @NO, @"steps": @[step(@"trust", YES, YES), step(@"developer-mode", NO, YES)]});
  MVCheck(@"connect: Developer Mode says first that the phone restarts", says(hub, @"Your phone restarts when you turn this on.") && says(hub, @"Settings, Privacy & Security, Developer Mode."), wordsOf(hub));
}

static void checkAdb(MVHub *hub) {
  NSDictionary *guide = @{@"hand": @"android", @"maker": @"samsung", @"ready": @NO, @"terms": @"https://terms.example", @"steps": @[step(@"get-adb", NO, YES), step(@"developer-options", NO, NO)]};
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
  MVCheck(@"adb: a failure says what it said", [wordsOf(hub) containsString:@"no network"], wordsOf(hub));
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
  [hub pokeClick:@"noteClients"];
  MVPump(0.3);
  MVCheck(@"done: AI Clients is one step away", [hub.placeShown isKindOfClass:MVClientsPane.class], nil);
  [hub show:@{@"devices": @[]}];
}

static void checkNeedsYou(MVHub *hub) {
  NSDictionary *held = @{@"id": @"H", @"serial": @"H", @"kind": @"phone", @"state": @"running", @"name": @"Held Phone", @"need": @"not-trusted"};
  [hub show:@{@"devices": @[held]}];
  [hub pokeRow:@"Tools"];
  MVPump(0.2);
  [hub pokeRow:@"Held Phone"];
  MVPump(0.2);
  MVCheck(@"connect: a phone under Needs You opens on its step, and starts no stream", [hub.placeShown isKindOfClass:MVConnectPane.class] && hub.chosen == nil, hub.chosen);
  [hub show:@{@"devices": @[]}];
}

static void checkTools(MVHub *hub, MVToolsPane *tools) {
  [hub pokeRow:@"Tools"];
  MVPump(0.2);
  MVCheck(@"tools: a real click on its row takes the room", hub.placeShown == tools, nil);
  [hub pokeClick:@"run:baseline"];
  MVPump(0.1);
  MVCheck(@"tools: a row says what it needs, and asks nothing", says(hub, @"Choose an app first."), wordsOf(hub));
  [tools fillDevice:nil];
  [hub pokeClick:@"run:flows"];
  MVPump(0.1);
  MVCheck(@"tools: so does one that needs a device", says(hub, @"Choose a device first."), wordsOf(hub));
  [tools chooseApp:@"com.example.app" folder:@"/flows"];
  [tools fillDevice:@{@"id": @"S", @"serial": @"S", @"name": @"A Simulator", @"kind": @"simulator"}];
  for (NSString *name in @[@"baseline", @"compare", @"why", @"survey", @"flows", @"timeline", @"flight", @"dashboard", @"tools", @"clients-preview", @"update-check", @"update"]) {
    NSDictionary *asked = clicked(hub, [@"run:" stringByAppendingString:name]);
    MVCheck([@"tools: a click runs " stringByAppendingString:name], [asked[@"do"] isEqual:@"run"] && [asked[@"name"] isEqual:name], asked.description);
  }
  NSDictionary *run = clicked(hub, @"run:flows");
  MVCheck(@"tools: a run takes the app, device and folder chosen", [run[@"device"] isEqual:@"S"] && [run[@"folder"] isEqual:@"/flows"] && [run[@"app"] isEqual:@"com.example.app"], run.description);
  [hub showClients:@{@"run": @{@"name": @"compare", @"started": @YES, @"command": @"appdyno perf compare --app com.example.app"}}];
  [hub showClients:@{@"run": @{@"name": @"compare", @"text": @"launch 553 ms slower\n"}}];
  MVPump(0.1);
  MVCheck(@"tools: a run says its command and what comes back", [wordsOf(hub) containsString:@"launch 553 ms slower"] && [wordsOf(hub) containsString:@"perf compare"], wordsOf(hub));
  NSDictionary *stop = clicked(hub, @"run:compare");
  MVCheck(@"tools: a run under way has Stop", [stop[@"stop"] boolValue] && [stop[@"name"] isEqual:@"compare"], stop.description);
  [hub showClients:@{@"run": @{@"name": @"compare", @"code": @1}}];
  MVPump(0.1);
  MVCheck(@"tools: the gate's refusal is said in words", says(hub, @"Regression found"), wordsOf(hub));
  [hub showClients:@{@"run": @{@"name": @"dashboard", @"started": @YES, @"command": @"appdyno perf dashboard"}}];
  [hub showClients:@{@"run": @{@"name": @"dashboard", @"code": @0, @"file": @"/x/index.html"}}];
  MVPump(0.1);
  MVCheck(@"tools: a dashboard opens as it is done, and no page opens from a test", [MVLastOpened() isEqual:@"/x/index.html"], MVLastOpened());
  [hub showClients:@{@"run": @{@"name": @"timeline", @"started": @YES, @"command": @"appdyno timeline"}}];
  [hub showClients:@{@"run": @{@"name": @"timeline", @"code": @0, @"file": @"/x/timeline.html"}}];
  MVPump(0.1);
  [hub pokeClick:@"open:timeline"];
  MVPump(0.1);
  MVCheck(@"tools: any other page waits for a click", [MVLastOpened() isEqual:@"/x/timeline.html"], MVLastOpened());
  [hub showClients:@{@"run": @{@"name": @"clients-preview", @"started": @YES, @"command": @"appdyno install --dry-run"}}];
  [hub showClients:@{@"run": @{@"name": @"clients-preview", @"text": @"+ a line\n"}}];
  [hub showClients:@{@"run": @{@"name": @"clients-preview", @"code": @0}}];
  MVPump(0.1);
  MVCheck(@"tools: Add to All shows its lines first, and asks again", [clicked(hub, @"run:clients")[@"name"] isEqual:@"clients"], nil);
  [hub showClients:@{@"apps": @[@"com.kept.app"], @"fromApp": @YES}];
  MVPump(0.1);
  MVCheck(@"tools: PATH is offered only from the app", [clicked(hub, @"run:path-on")[@"name"] isEqual:@"path-on"], nil);
}

void MVCheckConnect(void) {
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
  checkAdb(hub);
  checkDone(hub);
  checkNeedsYou(hub);
  [hub pokeRow:@"Connect a Phone"];
  MVPump(0.2);
  MVCheck(@"connect: it stays reachable later", [hub.placeShown isKindOfClass:MVConnectPane.class], nil);
  checkTools(hub, hub.toolsPane);
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
