// The hub's devices as a person finds them: a section for each kind with every one listed and its Start, why a kind has
// none, and the sheet that makes one, which asks as it opens and says in itself what went wrong.
#import "HubParts.h"
#import "SelfTest.h"
#import "Words.h"

static NSMutableArray<NSDictionary *> *gSaid;

static NSArray<NSDictionary *> *hubAsked(NSString *action) {
  return [gSaid filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"op == 'hub' AND action == %@", action]];
}

static MVRow *_Nullable rowTitled(MVHub *hub, NSString *title) {
  for (MVRow *row in ((MVList *)[hub valueForKey:@"_list"]).rows)
    if ([row.title isEqual:title]) return row;
  return nil;
}

static NSDictionary *device(NSString *id, NSString *kind, NSString *state) {
  return @{@"id": id, @"kind": kind, @"state": state, @"name": id, @"platform": [kind isEqual:@"emulator"] ? @"android" : @"ios"};
}

/// Where each field and menu of a view ends on the right, in its window.
static void addEdges(NSView *view, NSMutableSet<NSNumber *> *edges) {
  BOOL field = [view isKindOfClass:NSTextField.class] && ((NSTextField *)view).editable;
  if (field || [view isKindOfClass:NSPopUpButton.class]) [edges addObject:@(round(NSMaxX([view convertRect:view.bounds toView:nil])))];
  for (NSView *sub in view.subviews) addEdges(sub, edges);
}

static NSView *_Nullable viewNamed(NSView *view, NSString *name) {
  if ([view.identifier isEqual:name]) return view;
  for (NSView *sub in view.subviews)
    if (viewNamed(sub, name)) return viewNamed(sub, name);
  return nil;
}

static void checkSections(void) {
  MVHub *hub = [[MVHub alloc] initWithShow:MVShowBehind poses:NO];
  NSMutableArray *devices = [NSMutableArray arrayWithObject:device(@"up", @"simulator", @"running")];
  for (int i = 0; i < 3; i++) [devices addObject:device([NSString stringWithFormat:@"off%d", i], @"simulator", @"stopped")];
  [hub show:@{@"devices": devices,
              @"kinds": @[@{@"kind": @"emulator"}, @{@"kind": @"simulator"}]}];
  NSArray<NSString *> *titles = hub.rowTitles;
  NSUInteger simulators = [titles indexOfObject:MVWord(@"Simulators")], emulators = [titles indexOfObject:MVWord(@"Emulators")];
  MVCheck(@"devices: a section for each kind, simulators first, the shut-down ones listed and not folded away", simulators != NSNotFound && emulators > simulators && [titles containsObject:@"off2"], [titles componentsJoinedByString:@"|"]);
  MVCheck(@"devices: what runs comes first in its section", [titles indexOfObject:@"up"] < [titles indexOfObject:@"off0"], [titles componentsJoinedByString:@"|"]);
  MVCheck(@"devices: a shut-down one has its Start, a running one none", [rowTitled(hub, @"off0").button isEqual:@"Start"] && !rowTitled(hub, @"up").button, nil);
  MVRow *none = rowTitled(hub, MVWord(@"No emulator yet"));
  MVCheck(@"devices: a kind with none says so, with New", [none.button isEqual:@"New…"], [titles componentsJoinedByString:@"|"]);
  MVCheck(@"devices: with devices to choose the window opens on them, not on Connect a Phone", hub.placeShown == nil && [hub.chosen isEqual:@"up"], hub.chosen);
  // a Start pressed: the device is said to start, and its row's button goes
  gSaid = [NSMutableArray array];
  MVTapEmits(^(NSDictionary *message) {
    [gSaid addObject:message];
  });
  NSWindow *window = hub.room.window;
  [window layoutIfNeeded];
  // the button's own action, as a table kept behind takes a test's click on some versions of macOS and not on others
  NSButton *start = MVFindControl(window.contentView, @"Start:off1");
  [start performClick:nil];
  MVPump(0.2);
  MVCheck(@"devices: a row's Start starts it, said as starting", start && [[hubAsked(@"start").lastObject objectForKey:@"id"] isEqual:@"off1"] && [rowTitled(hub, @"off1").detail isEqual:MVWord(@"Starting…")] && !rowTitled(hub, @"off1").button, [gSaid description]);
  [hub sayNote:@"Unable to boot device in current state: Booted"];
  MVCheck(@"devices: a start that failed says why where the device stands, and its Start comes back", [rowTitled(hub, @"off1").button isEqual:@"Start"] && [[hub valueForKey:@"_about"] stringValue].length > 20, [[hub valueForKey:@"_about"] stringValue]);
  // past eight a section folds at its header, and what runs stays in sight
  for (int i = 3; i < 12; i++) [devices addObject:device([NSString stringWithFormat:@"off%d", i], @"simulator", @"stopped")];
  [hub show:@{@"devices": devices,
              @"kinds": @[@{@"kind": @"simulator"}]}];
  NSString *open = [NSString stringWithFormat:@"▾ %@ (13)", MVWord(@"Simulators")];
  MVCheck(@"devices: a long section says its count, open", [hub.rowTitles containsObject:open] && [hub.rowTitles containsObject:@"off11"], [hub.rowTitles componentsJoinedByString:@"|"]);
  MVPokeRow(hub, open);
  MVPump(0.2);
  MVCheckRowClick(@"devices: folded, it keeps what runs", ![hub.rowTitles containsObject:@"off11"] && [hub.rowTitles containsObject:@"up"], [hub.rowTitles componentsJoinedByString:@"|"]);
  // why a kind has none, and what to do, where its tool fails; and that a slow one is still asked
  [hub show:@{@"devices": @[],
              @"kinds": @[@{@"kind": @"simulator",
                            @"problem": @{@"said": @"Xcode's license is not agreed to", @"fix": @"run `sudo xcodebuild -license accept` in a terminal, or open Xcode once and agree"}},
                          @{@"kind": @"emulator",
                            @"waiting": @YES}]}];
  MVRow *why = rowTitled(hub, MVSentence(@"Xcode's license is not agreed to"));
  MVCheck(@"devices: a kind whose tool fails says why, and what to do", why && [why.detail hasPrefix:MVCapitalized(MVSentence(@"run `sudo xcodebuild -license accept` in a terminal, or open Xcode once and agree"))], [hub.rowTitles componentsJoinedByString:@"|"]);
  MVCheck(@"devices: and one still asked says so", rowTitled(hub, MVWord(@"Asking for them…")) != nil, [hub.rowTitles componentsJoinedByString:@"|"]);
  MVCheck(@"devices: with no device at all Connect a Phone stands", hub.placeShown != nil, nil);
  MVTapEmits(nil);
  // an emulator chosen shut down runs under its serial, and is still the one chosen
  MVHub *other = [[MVHub alloc] initWithShow:MVShowBehind poses:NO];
  [other show:@{@"devices": @[device(@"up", @"simulator", @"running"), device(@"pixel", @"emulator", @"stopped")]}];
  [other poke:@{@"id": @"pixel"}];
  [other show:@{@"devices": @[device(@"up", @"simulator", @"running"), @{@"id": @"emulator-5554", @"serial": @"emulator-5554", @"kind": @"emulator", @"state": @"running", @"name": @"pixel"}]}];
  MVCheck(@"devices: an emulator chosen as it started stays chosen under its serial", [other.chosen isEqual:@"emulator-5554"], other.chosen);
}

static NSDictionary *catalog(void) {
  return @{@"models": @[@{@"name": @"iPhone 18 Pro", @"id": @"a"}, @{@"name": @"iPhone Duo", @"id": @"b"}],
           @"systems": @[@{@"name": @"iOS 26.5",
                           @"id": @"s1",
                           @"models": @[@"a"]},
                         @{@"name": @"iOS 27.2",
                           @"id": @"s2",
                           @"models": @[@"b"]},
                         @{@"name": @"iOS 27.2",
                           @"id": @"s3",
                           @"models": @[@"a", @"b"]}]};
}

static void checkSheet(void) {
  MVHub *hub = [[MVHub alloc] initWithShow:MVShowBehind poses:NO];
  [hub show:@{@"devices": @[device(@"up", @"simulator", @"running")],
              @"kinds": @[@{@"kind": @"simulator"}]}];
  NSWindow *window = hub.room.window;
  gSaid = [NSMutableArray array];
  MVTapEmits(^(NSDictionary *message) {
    [gSaid addObject:message];
  });
  [hub poke:@{@"ask": @"simulator"}];
  MVPump(0.2);
  NSWindow *panel = window.attachedSheet;
  NSView *sheet = panel.contentView;
  if (!panel || !sheet) return MVCheck(@"sheet: it stands at once", NO, nil);
  NSButton *create = MVFindControl(sheet, @"create");
  MVCheck(@"sheet: it stands at once, asks what can be made, and waits", sheet && [[hubAsked(@"choices").lastObject objectForKey:@"kind"] isEqual:@"simulator"] && !create.enabled && [((NSTextField *)viewNamed(sheet, @"newStatus")).stringValue isEqual:MVWord(@"Reading what this Mac can make…")], [gSaid description]);
  [hub show:@{@"choices": @{@"simulator": @{@"problem": @{@"said": @"No iOS runtime is installed", @"fix": @"Xcode, Settings, Components: get iOS, then try again"}}}}];
  MVPump(0.1);
  NSString *status = ((NSTextField *)viewNamed(sheet, @"newStatus")).stringValue;
  MVCheck(@"sheet: what failed is said in it, with what to do and Try Again", [status hasPrefix:MVSentence(@"No iOS runtime is installed")] && !MVFindControl(sheet, @"newRetry").hidden && !create.enabled, status);
  MVClickControl(panel, MVFindControl(sheet, @"newRetry"), @"newRetry");
  MVPump(0.1);
  MVCheck(@"sheet: Try Again asks again", hubAsked(@"choices").count == 2, [gSaid description]);
  [hub show:@{@"choices": @{@"simulator": catalog()}}];
  MVPump(0.1);
  NSPopUpButton *system = (NSPopUpButton *)viewNamed(sheet, @"system"), *model = (NSPopUpButton *)viewNamed(sheet, @"model");
  // two runtimes of one name, as iOS 27.2 and the iOS 27.2 of one model: each a row, and the newest chosen
  MVCheck(@"sheet: a system of a name another has is a row of its own, and the last is chosen", system.numberOfItems == 3 && system.indexOfSelectedItem == 2 && create.enabled, [NSString stringWithFormat:@"%ld rows, %ld chosen", (long)system.numberOfItems, (long)system.indexOfSelectedItem]);
  [model selectItemAtIndex:1];
  [system selectItemAtIndex:1];
  [system sendAction:system.action to:system.target];
  MVCheck(@"sheet: a system offers only the models it runs, and the one chosen stays", model.numberOfItems == 1 && [model.selectedItem.representedObject isEqual:@"b"], [model.itemTitles componentsJoinedByString:@"|"]);
  [system selectItemAtIndex:0];
  [system sendAction:system.action to:system.target];
  MVCheck(@"sheet: and where it does not run it, the first it does", model.numberOfItems == 1 && [model.selectedItem.representedObject isEqual:@"a"], [model.itemTitles componentsJoinedByString:@"|"]);
  NSMutableSet<NSNumber *> *edges = [NSMutableSet set];
  [sheet layoutSubtreeIfNeeded];
  addEdges(sheet, edges);
  MVCheck(@"sheet: its name, model and system end on one edge", edges.count == 1, edges.description);
  [hub poke:@{@"press": @"create", @"name": @"Made"}];
  NSDictionary *asked = hubAsked(@"new").lastObject;
  MVCheck(@"sheet: Create asks for the model and system chosen, and the sheet stays, making it", [asked[@"model"] isEqual:@"a"] && [asked[@"system"] isEqual:@"s1"] && [asked[@"name"] isEqual:@"Made"] && window.attachedSheet && !create.enabled, [asked description]);
  [hub show:@{@"made": @{@"kind": @"simulator", @"problem": @{@"said": @"Incompatible device"}}}];
  MVPump(0.1);
  MVCheck(@"sheet: why it was not made is said in it, and Create can be pressed again", window.attachedSheet && create.enabled && [((NSTextField *)viewNamed(sheet, @"newStatus")).stringValue isEqual:@"Incompatible device"], nil);
  [hub show:@{@"made": @{@"kind": @"simulator", @"id": @"new"}}];
  MVPump(0.6);
  [hub show:@{@"devices": @[device(@"up", @"simulator", @"running"), device(@"new", @"simulator", @"stopped")],
              @"kinds": @[@{@"kind": @"simulator"}]}];
  MVPump(0.1);
  MVCheck(@"sheet: one made closes it, and is chosen, said as starting", !window.attachedSheet && [rowTitled(hub, @"new").detail isEqual:MVWord(@"Starting…")] && [[hub valueForKey:@"_shown"][@"id"] isEqual:@"new"], hub.chosen);
  // under a device allow list Create is refused, and the reason is said before it is pressed
  NSString *why = @"The hub was started with a list of allowed devices, so it makes no new one: start it without --allow-devices to make one.";
  [hub poke:@{@"ask": @"emulator"}];
  MVPump(0.2);
  [hub show:@{@"choices": @{@"emulator": @{@"models": @[@{@"name": @"Pixel 9", @"id": @"p"}], @"systems": @[@{@"name": @"API 36", @"id": @"i"}], @"refused": why}}}];
  MVPump(0.1);
  sheet = window.attachedSheet.contentView;
  if (!sheet) return MVCheck(@"sheet: New Emulator stands", NO, nil);
  NSTextField *refused = (NSTextField *)viewNamed(sheet, @"newRefused");
  MVCheck(@"sheet: a sheet that can make none says why, whole, and cannot be sent", [refused.stringValue isEqual:MVWord(why)] && !refused.hidden && NSHeight(refused.frame) > 20 && !MVFindControl(sheet, @"create").enabled, refused.stringValue);
  if (window.attachedSheet) [window endSheet:window.attachedSheet];
  MVPump(0.2);
  MVTapEmits(nil);
}

void MVCheckHubDevices(void) {
  checkSections();
  checkSheet();
}
