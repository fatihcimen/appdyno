// The sheet that makes a new simulator or emulator. It stands at once and asks the hub what can be made, so a tool that
// failed or was slow when the hub started answers now; what goes wrong is said in the sheet, which stays.
#import "Window.h"
#import "Words.h"

@implementation MVNewDevice {
  NSPanel *_sheet;
  NSStackView *_stack;
  NSTextField *_name, *_status, *_why;
  NSPopUpButton *_model, *_os;
  NSProgressIndicator *_spin;
  NSButton *_create, *_again;
  NSArray<NSDictionary *> *_models, *_systems;
  NSString *_kind;
  BOOL _refused;
  __weak NSWindow *_owner;
}

/// A row a menu item: by the menu, as the button's own add drops an item of the same title, and two runtimes may share
/// one (iOS 27.2 and the iOS 27.2 of a single model), which left an index past the items and Create doing nothing.
static void fill(NSPopUpButton *button, NSArray<NSDictionary *> *rows, NSString * (^title)(NSDictionary *)) {
  [button removeAllItems];
  for (NSDictionary *row in rows) [button.menu addItemWithTitle:title(row) action:nil keyEquivalent:@""];
}

static NSPopUpButton *popUp(NSString *name) {
  NSPopUpButton *button = [NSPopUpButton new];
  button.identifier = name;
  return button;
}

/// An Android system image as a person reads it: `system-images;android-36;google_apis_playstore;arm64-v8a` is Android 16
/// (API 36), Google Play. An iOS runtime's name is that already.
NSString *MVSystemName(NSDictionary *row) {
  NSArray<NSString *> *parts = [[row[@"id"] description] componentsSeparatedByString:@";"];
  if (parts.count < 3 || ![parts[1] hasPrefix:@"android-"]) return row[@"name"] ?: @"";
  NSInteger api = [parts[1] substringFromIndex:8].integerValue;
  NSDictionary<NSNumber *, NSString *> *versions = @{@26: @"8.0",
                                                     @27: @"8.1",
                                                     @28: @"9",
                                                     @29: @"10",
                                                     @30: @"11",
                                                     @31: @"12",
                                                     @32: @"12L",
                                                     @33: @"13",
                                                     @34: @"14",
                                                     @35: @"15",
                                                     @36: @"16",
                                                     @37: @"17"};
  NSDictionary<NSString *, NSString *> *tags = @{@"google_apis_playstore": @"Google Play", @"google_apis": @"Google APIs", @"default": @"AOSP", @"google_atd": @"Google ATD", @"aosp_atd": @"AOSP ATD"};
  NSString *tag = tags[parts[2]] ?: parts[2], *version = versions[@(api)];
  return version ? [NSString stringWithFormat:@"Android %@ (API %ld), %@", version, (long)api, tag] : [NSString stringWithFormat:@"API %ld, %@", (long)api, tag];
}

- (void)askIn:(NSWindow *)window kind:(NSString *)kind {
  _kind = kind;
  _owner = window;
  _name = [NSTextField textFieldWithString:@""];
  _name.placeholderString = [kind isEqual:@"simulator"] ? MVWord(@"The model's name") : @"appdyno_emulator";
  _model = popUp(@"model");
  _os = popUp(@"system");
  _os.target = self;
  _os.action = @selector(systemChosen:);
  NSTextField * (^caption)(NSString *) = ^(NSString *text) {
    return [NSTextField labelWithString:text];
  };
  NSGridView *grid = [NSGridView gridViewWithViews:@[@[caption(MVWord(@"Name")), _name], @[caption(MVWord(@"Model")), _model], @[caption([kind isEqual:@"simulator"] ? @"iOS" : @"Android"), _os]]];
  grid.rowSpacing = 12;
  grid.columnSpacing = 8;
  // a caption on the line its control's words stand on, as a form of the system's has it
  grid.rowAlignment = NSGridRowAlignmentFirstBaseline;
  [grid columnAtIndex:0].xPlacement = NSGridCellPlacementTrailing;
  // one edge for the field and both menus, as wide as the widest of them
  [grid columnAtIndex:1].xPlacement = NSGridCellPlacementFill;
  NSButton *cancel = [NSButton buttonWithTitle:MVWord(@"Cancel") target:self action:@selector(cancel:)];
  cancel.keyEquivalent = @"\e";
  cancel.identifier = @"cancel";
  _create = [NSButton buttonWithTitle:MVWord(@"Create") target:self action:@selector(create:)];
  _create.keyEquivalent = @"\r";
  _create.identifier = @"create";
  _again = [NSButton buttonWithTitle:MVWord(@"Try Again") target:self action:@selector(askAgain:)];
  _again.identifier = @"newRetry";
  // at the sheet's trailing edge, the default last, as the system's own sheets stand
  NSStackView *buttons = [NSStackView new];
  [buttons setViews:@[_again, cancel, _create] inGravity:NSStackViewGravityTrailing];
  NSTextField *title = MVText([kind isEqual:@"simulator"] ? @"New Simulator" : @"New Emulator", MVStyleTitle);
  title.font = [NSFont systemFontOfSize:15 weight:NSFontWeightSemibold];
  // why the hub makes none under an allow list, said before Create is pressed rather than after, behind the sheet
  _why = MVWrappedText(@"", MVStyleSub);
  _why.identifier = @"newRefused";
  _status = MVWrappedText(@"", MVStyleSub);
  _status.identifier = @"newStatus";
  for (NSTextField *field in @[_why, _status]) {
    field.maximumNumberOfLines = 0;
    field.preferredMaxLayoutWidth = 340;
  }
  _spin = [NSProgressIndicator new];
  _spin.style = NSProgressIndicatorStyleSpinning;
  _spin.controlSize = NSControlSizeSmall;
  NSStackView *line = [NSStackView stackViewWithViews:@[_spin, _status]];
  line.alignment = NSLayoutAttributeFirstBaseline;
  _stack = [NSStackView stackViewWithViews:@[title, grid, _why, line, buttons]];
  _stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  _stack.alignment = NSLayoutAttributeLeading;
  _stack.spacing = 16;
  _stack.edgeInsets = NSEdgeInsetsMake(20, 20, 20, 20);
  [buttons.trailingAnchor constraintEqualToAnchor:grid.trailingAnchor].active = YES;
  [_name.widthAnchor constraintGreaterThanOrEqualToConstant:260].active = YES;
  _sheet = [[NSPanel alloc] initWithContentRect:NSMakeRect(0, 0, 380, 220) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  _sheet.contentView = _stack;
  _sheet.defaultButtonCell = _create.cell;
  [self askAgain:nil];
  [window beginSheet:_sheet completionHandler:nil];
}

/// One state of the sheet: whether it waits, what it says, and whether Create can be pressed.
- (void)say:(NSString *)words waiting:(BOOL)waiting {
  _status.stringValue = words;
  _status.superview.hidden = !words.length;
  _spin.hidden = !waiting;
  waiting ? [_spin startAnimation:nil] : [_spin stopAnimation:nil];
  BOOL filled = _model.numberOfItems > 0 && _os.numberOfItems > 0;
  _create.enabled = !waiting && filled && !_refused;
  _model.enabled = _os.enabled = _name.enabled = !waiting && filled;
  _again.hidden = waiting || filled;
  // as tall as its rows, once a line hidden has left: room left over stood under the buttons
  [_stack layoutSubtreeIfNeeded];
  [_sheet setContentSize:_stack.fittingSize];
}

/// A failure in a person's words: what went wrong, then what to do.
static NSString *problemWords(NSDictionary *problem) {
  NSString *said = MVSentence(problem[@"said"] ?: @""), *fix = MVCapitalized(MVSentence(problem[@"fix"] ?: @""));
  return fix.length ? [NSString stringWithFormat:@"%@.\n%@.", said, fix] : said;
}

- (void)askAgain:(id)sender {
  [self say:MVWord(@"Reading what this Mac can make…") waiting:YES];
  MVEmit(@{@"op": @"hub", @"action": @"choices", @"kind": _kind});
}

- (void)heard:(NSDictionary *)choices {
  NSDictionary *mine = choices[_kind];
  if (![mine isKindOfClass:NSDictionary.class]) return;
  NSString *refused = [mine[@"refused"] isKindOfClass:NSString.class] ? mine[@"refused"] : @"";
  _refused = refused.length > 0;
  _why.stringValue = MVSentence(refused);
  _why.hidden = !_refused;
  _models = [mine[@"models"] isKindOfClass:NSArray.class] ? mine[@"models"] : @[];
  _systems = [mine[@"systems"] isKindOfClass:NSArray.class] ? mine[@"systems"] : @[];
  fill(_os, _systems, ^(NSDictionary *row) {
    return MVSystemName(row);
  });
  // the newest comes last, and is the one a newest model runs on
  if (_systems.count) [_os selectItemAtIndex:(NSInteger)_systems.count - 1];
  [self systemChosen:nil];
  NSDictionary *problem = [mine[@"problem"] isKindOfClass:NSDictionary.class] ? mine[@"problem"] : nil;
  [self say:problem ? problemWords(problem) : @"" waiting:NO];
}

/// The models the system chosen runs, as most pairs of a model and a system fail: the one chosen stays where it can.
- (NSArray<NSDictionary *> *)modelsFor:(nullable NSDictionary *)system {
  NSArray *runs = [system[@"models"] isKindOfClass:NSArray.class] ? system[@"models"] : nil;
  if (!runs) return _models;
  return [_models filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSDictionary *model, __unused NSDictionary *bindings) {
                    return [runs containsObject:model[@"id"]];
                  }]];
}

- (void)systemChosen:(id)sender {
  NSInteger at = _os.indexOfSelectedItem;
  NSArray<NSDictionary *> *models = [self modelsFor:at >= 0 ? _systems[(NSUInteger)at] : nil];
  NSString *was = _model.indexOfSelectedItem >= 0 ? _model.selectedItem.representedObject : nil;
  fill(_model, models, ^(NSDictionary *row) {
    return (NSString *)row[@"name"];
  });
  [_model.itemArray enumerateObjectsUsingBlock:^(NSMenuItem *item, NSUInteger i, __unused BOOL *stop) {
    item.representedObject = models[i][@"id"];
    if ([item.representedObject isEqual:was]) [self->_model selectItem:item];
  }];
  _create.enabled = _model.numberOfItems > 0 && !_refused;
}

- (void)failed:(nullable NSDictionary *)problem {
  [self say:problemWords(problem ?: @{}) waiting:NO];
}

- (void)done {
  [_owner endSheet:_sheet];
}

- (void)setName:(NSString *)name {
  _name.stringValue = name;
}

- (void)cancel:(id)sender {
  [_owner endSheet:_sheet];
}

/// The sheet stays until the hub says it made one, or why not.
- (void)create:(id)sender {
  if (_model.indexOfSelectedItem < 0 || _os.indexOfSelectedItem < 0 || !_create.enabled) return;
  MVEmit(@{@"op": @"hub", @"action": @"new", @"kind": _kind, @"name": _name.stringValue, @"model": _model.selectedItem.representedObject ?: @"", @"system": _systems[(NSUInteger)_os.indexOfSelectedItem][@"id"]});
  [self say:MVWord(@"Making it…") waiting:YES];
}

@end
