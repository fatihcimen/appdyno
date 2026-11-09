// The sheet that makes a new simulator or emulator, from what the parent says can be made.
#import "Window.h"
#import "Words.h"

@implementation MVNewDevice {
  NSPanel *_sheet;
  NSTextField *_name;
  NSPopUpButton *_model, *_os;
  NSArray<NSDictionary *> *_models, *_systems;
  NSString *_kind;
  __weak NSWindow *_owner;
}

static NSPopUpButton *popUp(NSArray<NSDictionary *> *rows) {
  NSPopUpButton *button = [NSPopUpButton new];
  for (NSDictionary *row in rows) [button addItemWithTitle:row[@"name"]];
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

- (void)askIn:(NSWindow *)window kind:(NSString *)kind choices:(NSDictionary *)choices {
  _kind = kind;
  _owner = window;
  _models = choices[@"models"] ?: @[];
  _systems = choices[@"systems"] ?: @[];
  _name = [NSTextField textFieldWithString:@""];
  _name.placeholderString = [kind isEqual:@"simulator"] ? MVWord(@"The model's name") : @"appdyno_emulator";
  _model = popUp(_models);
  _os = popUp(_systems);
  for (NSInteger i = 0; i < _os.numberOfItems; i++) [_os itemAtIndex:i].title = MVSystemName(_systems[(NSUInteger)i]);
  // the newest comes last, and is the one a newest model runs on
  [_os selectItemAtIndex:_systems.count - 1];
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
  NSButton *create = [NSButton buttonWithTitle:MVWord(@"Create") target:self action:@selector(create:)];
  create.keyEquivalent = @"\r";
  create.identifier = @"create";
  cancel.identifier = @"cancel";
  // at the sheet's trailing edge, the default last, as the system's own sheets stand
  NSStackView *buttons = [NSStackView new];
  [buttons setViews:@[cancel, create] inGravity:NSStackViewGravityTrailing];
  NSTextField *title = MVText([kind isEqual:@"simulator"] ? @"New Simulator" : @"New Emulator", MVStyleTitle);
  title.font = [NSFont systemFontOfSize:15 weight:NSFontWeightSemibold];
  NSStackView *stack = [NSStackView stackViewWithViews:@[title, grid, buttons]];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.alignment = NSLayoutAttributeLeading;
  stack.spacing = 16;
  stack.edgeInsets = NSEdgeInsetsMake(20, 20, 20, 20);
  [buttons.trailingAnchor constraintEqualToAnchor:grid.trailingAnchor].active = YES;
  [_name.widthAnchor constraintGreaterThanOrEqualToConstant:260].active = YES;
  _sheet = [[NSPanel alloc] initWithContentRect:NSMakeRect(0, 0, 380, 220) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  _sheet.contentView = stack;
  // as tall as its rows: room left over would stand between two of them
  [_sheet setContentSize:stack.fittingSize];
  _sheet.defaultButtonCell = create.cell;
  [window beginSheet:_sheet completionHandler:nil];
}

- (void)setName:(NSString *)name {
  _name.stringValue = name;
}

- (void)cancel:(id)sender {
  [_owner endSheet:_sheet];
}

- (void)create:(id)sender {
  if (_model.indexOfSelectedItem < 0 || _os.indexOfSelectedItem < 0) return;
  MVEmit(@{@"op": @"hub", @"action": @"new", @"kind": _kind, @"name": _name.stringValue, @"model": _models[_model.indexOfSelectedItem][@"id"], @"system": _systems[_os.indexOfSelectedItem][@"id"]});
  [_owner endSheet:_sheet];
}

@end
