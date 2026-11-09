// Tools with no parent: every control is pressed by a real click through the window's hit testing, and what a click
// asks of the parent is heard here. A device run has the parent.
#import "Place.h"
#import "SelfTest.h"
#import "Words.h"

static NSMutableArray<NSDictionary *> *gAsked;

/// A real click, and the one word it asked of the parent.
static NSDictionary *clicked(MVHub *hub, NSString *name) {
  [gAsked removeAllObjects];
  [hub pokeClick:name];
  MVPump(0.1);
  return gAsked.lastObject;
}

static NSString *wordsOf(MVHub *hub) {
  return [[hub.parts valueForKey:@"text"] componentsJoinedByString:@"|"];
}

static BOOL says(MVHub *hub, NSString *english) {
  return [wordsOf(hub) containsString:MVWord(english)];
}

/// Whatever goes on turning under a view.
static BOOL turning(NSView *view) {
  if ([view isKindOfClass:NSProgressIndicator.class] && !view.hiddenOrHasHiddenAncestor) return YES;
  for (NSView *sub in view.subviews)
    if (turning(sub)) return YES;
  return NO;
}

/// The label that says these words, under a view.
static NSView *labelSaying(NSView *view, NSString *words) {
  if ([view isKindOfClass:NSTextField.class] && !((NSTextField *)view).editable && [((NSTextField *)view).stringValue isEqual:words]) return view;
  for (NSView *sub in view.subviews) {
    NSView *found = labelSaying(sub, words);
    if (found) return found;
  }
  return nil;
}

@interface MVToolsPane (Picked)
- (void)appPicked:(NSMenuItem *)item;
@end

void MVCheckTools(MVHub *hub) {
  gAsked = [NSMutableArray array];
  MVTapAsks(^(NSDictionary *message) {
    NSString *what = message[@"do"];
    if (![what isEqual:@"list"] && ![what isEqual:@"apps"] && !([what isEqual:@"connect"] && ![message[@"fresh"] boolValue])) [gAsked addObject:message];
  });
  MVToolsPane *tools = hub.toolsPane;
  MVPokeRow(hub, @"Tools");
  MVPump(0.2);
  MVCheckRowClick(@"tools: a real click on its row takes the room", hub.placeShown == tools, nil);
  [tools chooseApp:@"" folder:@""];
  [tools fillDevice:nil];
  NSView *top = hub.room.window.contentView;
  [top layoutSubtreeIfNeeded];
  NSView *appName = labelSaying(top, MVWord(@"App")), *appList = MVFindControl(top, @"appList");
  double nameMid = NSMidY([appName convertRect:appName.bounds toView:nil]), listMid = NSMidY([appList convertRect:appList.bounds toView:nil]);
  MVCheck(@"tools: App stands on the line of its field", appName && appList && fabs(nameMid - listMid) < 1.5, [NSString stringWithFormat:@"%.1f, %.1f", nameMid, listMid]);
  MVCheck(@"tools: a row says what it lacks where its button stood", says(hub, @"Needs an app") && !MVFindControl(hub.room.window.contentView, @"run:baseline").enabled, wordsOf(hub));
  MVCheck(@"tools: a row that lacks something asks nothing", clicked(hub, @"run:baseline") == nil, nil);
  [hub pokeClick:@"index:4"];
  MVPump(0.2);
  MVCheck(@"tools: its index stays, and takes the page to a section", MVFindControl(hub.room.window.contentView, @"index:0") != nil, nil);
  [tools chooseApp:@"com.example.app" folder:@"/flows"];
  [tools fillDevice:@{@"id": @"S", @"serial": @"S", @"name": @"A Simulator", @"kind": @"simulator"}];
  for (NSString *name in @[@"baseline", @"compare", @"why", @"survey", @"flows", @"timeline", @"flight", @"dashboard", @"tools", @"clients-preview", @"update-check", @"update"]) {
    NSDictionary *asked = clicked(hub, [@"run:" stringByAppendingString:name]);
    MVCheck([@"tools: a click runs " stringByAppendingString:name], [asked[@"do"] isEqual:@"run"] && [asked[@"name"] isEqual:name], asked.description);
  }
  NSDictionary *run = clicked(hub, @"run:flows");
  MVCheck(@"tools: a run takes the app, device and folder chosen", [run[@"device"] isEqual:@"S"] && [run[@"folder"] isEqual:@"/flows"] && [run[@"app"] isEqual:@"com.example.app"], run.description);
  NSDictionary *none = clicked(hub, @"appList");
  MVCheck(@"tools: behind others, the list of apps opens no menu on a person's screen", none == nil, none.description);
  [tools appPicked:[[NSMenuItem alloc] initWithTitle:@"com.example.picked" action:nil keyEquivalent:@""]];
  MVCheck(@"tools: an app picked from the list is the app a run takes", [clicked(hub, @"run:flows")[@"app"] isEqual:@"com.example.picked"], nil);
  [tools chooseApp:@"com.example.app" folder:@"/flows"];
  [hub showClients:@{@"run": @{@"name": @"compare", @"started": @YES, @"command": @"appdyno perf compare --app com.example.app"}}];
  [hub showClients:@{@"run": @{@"name": @"compare", @"text": @"launch 553 ms slower\n"}}];
  MVPump(0.1);
  MVCheck(@"tools: something turns while a run is under way", turning(hub.room.window.contentView), nil);
  MVCheck(@"tools: a log stays behind Show Details", ![wordsOf(hub) containsString:@"launch 553 ms slower"], wordsOf(hub));
  [hub pokeClick:@"details:compare"];
  MVPump(0.1);
  MVCheck(@"tools: which shows the command and what came back", [wordsOf(hub) containsString:@"launch 553 ms slower"] && [wordsOf(hub) containsString:@"perf compare"], wordsOf(hub));
  for (int line = 0; line < 30; line++) [hub showClients:@{@"run": @{@"name": @"compare", @"text": [NSString stringWithFormat:@"line %d\n", line]}}];
  MVPump(0.1);
  MVCheck(@"tools: a long run keeps its command in sight, and its newest lines", [wordsOf(hub) containsString:@"appdyno perf compare"] && [wordsOf(hub) containsString:@"line 29"] && ![wordsOf(hub) containsString:@"line 3\n"], nil);
  NSDictionary *stop = clicked(hub, @"run:compare");
  MVCheck(@"tools: a run under way has Stop", [stop[@"stop"] boolValue] && [stop[@"name"] isEqual:@"compare"], stop.description);
  [hub showClients:@{@"run": @{@"name": @"compare", @"code": @1, @"verdict": @"regression"}}];
  MVPump(0.1);
  MVCheck(@"tools: the gate's refusal is said in words", says(hub, @"Regression found"), wordsOf(hub));
  [hub showClients:@{@"run": @{@"name": @"compare", @"code": @0, @"verdict": @"unjudged"}}];
  MVPump(0.1);
  MVCheck(@"tools: what it could not judge is no pass, whatever the exit code", says(hub, @"Could not judge") && !says(hub, @"No regression"), wordsOf(hub));
  [hub showClients:@{@"run": @{@"name": @"compare", @"code": @1, @"verdict": @"unjudged"}}];
  MVPump(0.1);
  MVCheck(@"tools: and no regression either", says(hub, @"Could not judge") && !says(hub, @"Regression found"), wordsOf(hub));
  [hub showClients:@{@"run": @{@"name": @"compare", @"code": @0, @"verdict": @"clear"}}];
  MVPump(0.1);
  MVCheck(@"tools: only a clear answer is a pass", says(hub, @"No regression"), wordsOf(hub));
  MVCheck(@"tools: and nothing turns once it has ended: a window at rest stays at rest", !turning(hub.room.window.contentView), nil);
  [hub showClients:@{@"run": @{@"name": @"baseline", @"started": @YES, @"command": @"appdyno perf baseline"}}];
  [hub showClients:@{@"run": @{@"name": @"baseline", @"code": @1}}];
  MVPump(0.1);
  MVCheck(@"tools: a baseline short of runs says so, and is no failure", says(hub, @"Saved, but it needs more runs to compare with.") && !says(hub, @"It failed: see what it said."), wordsOf(hub));
  [hub showClients:@{@"run": @{@"name": @"dashboard", @"started": @YES, @"command": @"appdyno perf dashboard"}}];
  [hub showClients:@{@"run": @{@"name": @"dashboard", @"code": @0, @"file": @"/x/index.html"}}];
  MVPump(0.1);
  MVCheck(@"tools: a dashboard opens as it is done, and no page opens from a test", [MVLastOpened() isEqual:@"/x/index.html"], MVLastOpened());
  [hub showClients:@{@"run": @{@"name": @"timeline", @"started": @YES, @"command": @"appdyno timeline"}}];
  [hub showClients:@{@"run": @{@"name": @"timeline", @"code": @0, @"file": @"/x/timeline.html", @"count": @{@"frames": @1800}}}];
  MVPump(0.1);
  MVCheck(@"tools: a result is a person's sentence, with its device", says(hub, @"Timeline saved, with 1800 frames.") && [wordsOf(hub) containsString:@"A Simulator"] && ![wordsOf(hub) containsString:@"0 steps"], wordsOf(hub));
  MVPump(0.1);
  [hub pokeClick:@"open:timeline"];
  MVPump(0.1);
  MVCheck(@"tools: any other page waits for a click", [MVLastOpened() isEqual:@"/x/timeline.html"], MVLastOpened());
  [hub showClients:@{@"run": @{@"name": @"clients-preview", @"started": @YES, @"command": @"appdyno install --dry-run"}}];
  [hub showClients:@{@"run": @{@"name": @"clients-preview", @"text": @"+ a line\n"}}];
  [hub showClients:@{@"run": @{@"name": @"clients-preview", @"code": @0}}];
  MVPump(0.1);
  MVCheck(@"tools: one button: it shows the lines, and then adds them", [wordsOf(hub) containsString:@"+ a line"] && [clicked(hub, @"run:clients-preview")[@"name"] isEqual:@"clients"], wordsOf(hub));
  MVCheck(@"tools: PATH stands out of a run that is not the app's", MVFindControl(hub.room.window.contentView, @"run:path-on") == nil, nil);
  [hub showClients:@{@"apps": @[@"com.kept.app"],
                     @"fromApp": @YES}];
  MVPump(0.1);
  MVCheck(@"tools: PATH is offered only from the app", [clicked(hub, @"run:path-on")[@"name"] isEqual:@"path-on"], nil);
  MVCheck(@"tools: and comes off the same way", [clicked(hub, @"run:path-off")[@"name"] isEqual:@"path-off"], nil);
  MVCheck(@"tools: the app, which carries its own trace processor, offers none to get", MVFindControl(hub.room.window.contentView, @"run:tools") == nil, nil);
  [hub pokeClick:@"chooseFolder"];
  MVPump(0.1);
  MVCheck(@"tools: Choose asks for a folder, and takes no keyboard from a test", [MVLastOpened() isEqual:@"folder panel"], MVLastOpened());
}
